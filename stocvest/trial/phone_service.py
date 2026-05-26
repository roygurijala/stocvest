"""Phone OTP request/verify and trial start orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from stocvest.api.services.user_profile_store import UserProfileStore
from stocvest.data.models import UserProfile
from stocvest.trial.access import resolve_access
from stocvest.trial.otp_store import (
    OtpAttemptsExceededError,
    OtpExpiredError,
    RateLimitError,
    get_otp_store,
    increment_verify_attempt,
    record_otp_request,
)
from stocvest.trial.phone_crypto import (
    generate_otp_code,
    hash_otp,
    normalize_e164,
    phone_hmac,
    phone_last4,
    verify_otp,
)
from stocvest.trial.phone_ledger_store import PhoneAlreadyClaimedError, PhoneLedgerEntry, assert_phone_available, get_phone_ledger_store
from stocvest.trial.sms import send_trial_otp_sms
from stocvest.utils.config import get_settings


class PhoneVerificationError(Exception):
    def __init__(self, message: str, *, code: str = "bad_request") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PhoneVerifyResult:
    profile: UserProfile
    access: dict[str, object]


def _pepper() -> str:
    settings = get_settings()
    pepper = (settings.trial_phone_hmac_pepper or "").strip()
    if pepper:
        return pepper
    if settings.is_development:
        return "dev-only-trial-pepper-not-for-production"
    raise PhoneVerificationError("Phone verification is not configured.", code="internal_error")


def request_phone_code(
    *,
    user_id: str,
    profile: UserProfile,
    phone_raw: str,
    sms_opt_in: bool,
    store: UserProfileStore,
) -> dict[str, str]:
    settings = get_settings()
    if not settings.phone_verification_required and not settings.trial_enforcement_enabled:
        raise PhoneVerificationError("Phone verification is not enabled.", code="forbidden")

    if profile.phone_verified and profile.trial_active:
        raise PhoneVerificationError("Phone already verified.", code="conflict")

    if not sms_opt_in:
        raise PhoneVerificationError("SMS consent is required to verify your phone.")

    e164 = normalize_e164(phone_raw)
    if not e164:
        raise PhoneVerificationError("Enter a valid mobile number in E.164 format (e.g. +15551234567).")

    pepper = _pepper()
    hmac_val = phone_hmac(e164, pepper=pepper)
    ledger = get_phone_ledger_store()
    try:
        assert_phone_available(hmac_val, user_id, ledger)
    except PhoneAlreadyClaimedError as exc:
        raise PhoneVerificationError(str(exc), code="conflict") from exc

    otp_store = get_otp_store()
    existing = otp_store.get(user_id)
    try:
        code = generate_otp_code()
        otp_hash = hash_otp(code, pepper=pepper, user_id=user_id)
        session = record_otp_request(existing, user_id=user_id, phone_e164=e164, otp_hash=otp_hash)
        otp_store.put(session)
    except RateLimitError as exc:
        raise PhoneVerificationError(str(exc), code="rate_limited") from exc

    send_trial_otp_sms(phone_e164=e164, code=code)

    pending = profile.model_copy(
        update={
            "phone_last4": phone_last4(e164),
            "sms_marketing_opt_in": bool(sms_opt_in),
        }
    )
    store.put_profile(pending)

    return {
        "status": "code_sent",
        "phone_last4": phone_last4(e164),
        "expires_in_seconds": str(max(60, settings.trial_otp_ttl_seconds)),
    }


def verify_phone_code(
    *,
    user_id: str,
    profile: UserProfile,
    code_raw: str,
    store: UserProfileStore,
    is_admin: bool = False,
) -> PhoneVerifyResult:
    settings = get_settings()
    if not settings.phone_verification_required and not settings.trial_enforcement_enabled:
        raise PhoneVerificationError("Phone verification is not enabled.", code="forbidden")

    code = str(code_raw or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise PhoneVerificationError("Enter the 6-digit verification code.")

    if profile.phone_verified and profile.trial_active:
        snap = resolve_access(profile, is_admin=is_admin)
        return PhoneVerifyResult(profile=profile, access=_access_dict(snap))

    otp_store = get_otp_store()
    session = otp_store.get(user_id)
    if session is None:
        raise PhoneVerificationError("No active verification code. Request a new one.")

    try:
        from stocvest.trial.otp_store import assert_can_verify

        assert_can_verify(session)
    except OtpExpiredError as exc:
        otp_store.delete(user_id)
        raise PhoneVerificationError(str(exc), code="bad_request") from exc
    except OtpAttemptsExceededError as exc:
        otp_store.delete(user_id)
        raise PhoneVerificationError(str(exc), code="bad_request") from exc

    pepper = _pepper()
    if not verify_otp(code, expected_hash=session.otp_hash, pepper=pepper, user_id=user_id):
        updated = increment_verify_attempt(session)
        otp_store.put(updated)
        raise PhoneVerificationError("Incorrect verification code.")

    e164 = session.phone_e164
    hmac_val = phone_hmac(e164, pepper=pepper)
    ledger = get_phone_ledger_store()
    try:
        assert_phone_available(hmac_val, user_id, ledger)
    except PhoneAlreadyClaimedError as exc:
        raise PhoneVerificationError(str(exc), code="conflict") from exc

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    duration = max(1, settings.trial_duration_days)
    ends = (now + timedelta(days=duration)).isoformat()

    existing_entry = ledger.get(hmac_val)
    if existing_entry is None:
        ledger.put(
            PhoneLedgerEntry(
                phone_hmac=hmac_val,
                user_id=user_id,
                trial_started_at=now_iso,
            )
        )
        trial_started = now_iso
        trial_ends = ends
    elif existing_entry.user_id == user_id:
        trial_started = profile.trial_started_at or existing_entry.trial_started_at or now_iso
        trial_ends = profile.trial_ends_at or ends
    else:
        raise PhoneVerificationError("This phone number is already linked to another account.", code="conflict")

    merged = profile.model_copy(
        update={
            "phone_verified": True,
            "phone_verified_at": now_iso,
            "phone_hmac": hmac_val,
            "phone_last4": phone_last4(e164),
            "sms_marketing_opt_in": profile.sms_marketing_opt_in,
            "trial_started_at": trial_started,
            "trial_ends_at": trial_ends,
        }
    )
    store.put_profile(merged)
    otp_store.delete(user_id)

    snap = resolve_access(merged, is_admin=is_admin)
    return PhoneVerifyResult(profile=merged, access=_access_dict(snap))


def _access_dict(snap: object) -> dict[str, object]:
    from stocvest.trial.access import AccessSnapshot

    assert isinstance(snap, AccessSnapshot)
    return {
        "access_state": snap.access_state,
        "has_full_access": snap.has_full_access,
        "has_ai_explanations": snap.has_ai_explanations,
        "trial_days_remaining": snap.trial_days_remaining,
        "phone_verified": snap.phone_verified,
        "trial_started_at": snap.trial_started_at,
        "trial_ends_at": snap.trial_ends_at,
        "phone_last4": snap.phone_last4,
        "trial_enforcement_enabled": snap.trial_enforcement_enabled,
    }
