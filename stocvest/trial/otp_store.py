"""In-memory / DynamoDB OTP sessions with rate limits."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from stocvest.utils.config import get_settings


class RateLimitError(Exception):
    pass


class OtpExpiredError(Exception):
    pass


class OtpAttemptsExceededError(Exception):
    pass


@dataclass
class OtpSession:
    user_id: str
    phone_e164: str
    otp_hash: str
    expires_at: datetime
    attempts: int = 0
    last_sent_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    send_history: list[datetime] = field(default_factory=list)


class OtpStore(Protocol):
    def get(self, user_id: str) -> OtpSession | None: ...
    def put(self, session: OtpSession) -> None: ...
    def delete(self, user_id: str) -> None: ...


@dataclass
class InMemoryOtpStore:
    _sessions: dict[str, OtpSession] = field(default_factory=dict)

    def get(self, user_id: str) -> OtpSession | None:
        sess = self._sessions.get(user_id)
        if sess is None:
            return None
        if datetime.now(timezone.utc) >= sess.expires_at:
            self._sessions.pop(user_id, None)
            return None
        return sess

    def put(self, session: OtpSession) -> None:
        self._sessions[session.user_id] = session

    def delete(self, user_id: str) -> None:
        self._sessions.pop(user_id, None)


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def delete_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class DynamoOtpStore:
    table: DynamoTableLike
    pk_attr: str = "userId"
    sk_value: str = "PHONE_OTP"

    def _key(self, user_id: str) -> dict[str, str]:
        return {self.pk_attr: f"{user_id}#{self.sk_value}"}

    def get(self, user_id: str) -> OtpSession | None:
        resp = self.table.get_item(Key=self._key(user_id))
        item = resp.get("Item") or {}
        if not item:
            return None
        try:
            expires = datetime.fromisoformat(str(item["expiresAt"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            return None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= expires:
            self.delete(user_id)
            return None
        last_sent_raw = item.get("lastSentAt")
        last_sent = datetime.now(timezone.utc)
        if last_sent_raw:
            try:
                last_sent = datetime.fromisoformat(str(last_sent_raw).replace("Z", "+00:00"))
                if last_sent.tzinfo is None:
                    last_sent = last_sent.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        history_raw = item.get("sendHistory") or []
        history: list[datetime] = []
        for h in history_raw:
            try:
                dt = datetime.fromisoformat(str(h).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                history.append(dt)
            except ValueError:
                continue
        return OtpSession(
            user_id=user_id,
            phone_e164=str(item.get("phoneE164") or ""),
            otp_hash=str(item.get("otpHash") or ""),
            expires_at=expires,
            attempts=int(item.get("attempts") or 0),
            last_sent_at=last_sent,
            send_history=history,
        )

    def put(self, session: OtpSession) -> None:
        ttl = int(session.expires_at.timestamp())
        self.table.put_item(
            Item={
                self.pk_attr: f"{session.user_id}#{self.sk_value}",
                "phoneE164": session.phone_e164,
                "otpHash": session.otp_hash,
                "expiresAt": session.expires_at.isoformat(),
                "attempts": session.attempts,
                "lastSentAt": session.last_sent_at.isoformat(),
                "sendHistory": [h.isoformat() for h in session.send_history[-10:]],
                "ttl": ttl,
            }
        )

    def delete(self, user_id: str) -> None:
        self.table.delete_item(Key=self._key(user_id))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def assert_can_request_otp(existing: OtpSession | None) -> None:
    settings = get_settings()
    now = _now()
    if existing is not None:
        cooldown = timedelta(seconds=max(1, settings.trial_otp_request_cooldown_seconds))
        if now - existing.last_sent_at < cooldown:
            raise RateLimitError("Please wait before requesting another code.")
        window = now - timedelta(hours=1)
        recent = [t for t in existing.send_history if t >= window]
        if len(recent) >= max(1, settings.trial_otp_max_requests_per_hour):
            raise RateLimitError("Too many verification codes requested. Try again later.")


def record_otp_request(existing: OtpSession | None, *, user_id: str, phone_e164: str, otp_hash: str) -> OtpSession:
    settings = get_settings()
    assert_can_request_otp(existing)
    now = _now()
    history = list(existing.send_history if existing else [])
    history.append(now)
    session = OtpSession(
        user_id=user_id,
        phone_e164=phone_e164,
        otp_hash=otp_hash,
        expires_at=now + timedelta(seconds=max(60, settings.trial_otp_ttl_seconds)),
        attempts=0,
        last_sent_at=now,
        send_history=history,
    )
    return session


def assert_can_verify(session: OtpSession) -> None:
    settings = get_settings()
    if _now() >= session.expires_at:
        raise OtpExpiredError("Verification code expired. Request a new one.")
    if session.attempts >= max(1, settings.trial_otp_max_verify_attempts):
        raise OtpAttemptsExceededError("Too many incorrect attempts. Request a new code.")


def increment_verify_attempt(session: OtpSession) -> OtpSession:
    session.attempts += 1
    return session


_OTP_STORE: OtpStore | None = None


def get_otp_store() -> OtpStore:
    global _OTP_STORE
    if _OTP_STORE is None:
        settings = get_settings()
        table_name = (getattr(settings, "dynamodb_users_table", None) or "").strip()
        if table_name:
            import boto3

            table = boto3.resource("dynamodb").Table(table_name)
            _OTP_STORE = DynamoOtpStore(table=table)
        else:
            _OTP_STORE = InMemoryOtpStore()
    return _OTP_STORE


def reset_otp_store_for_tests() -> None:
    global _OTP_STORE
    _OTP_STORE = None
