"""User profile fields (trading mode, onboarding, legal ack) — DynamoDB or in-memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from stocvest.data.models import TradingMode, UserProfile
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


class UserProfileStore(Protocol):
    def get_profile(self, user_id: str) -> UserProfile: ...
    def set_trading_mode(self, user_id: str, mode: TradingMode) -> None: ...
    def put_profile(self, profile: UserProfile) -> None: ...


def _item_to_profile(user_id: str, item: dict[str, Any]) -> UserProfile:
    raw_tm = item.get("tradingMode")
    mode = TradingMode.PAPER
    if raw_tm is not None:
        try:
            mode = TradingMode(str(raw_tm).lower())
        except ValueError:
            mode = TradingMode.PAPER
    raw_email = item.get("email")
    email = str(raw_email).strip() if raw_email is not None and str(raw_email).strip() else None
    return UserProfile(
        user_id=user_id,
        email=email,
        trading_mode=mode,
        onboarding_completed=bool(item.get("onboardingCompleted")),
        onboarding_completed_at=_s(item.get("onboardingCompletedAt")),
        legal_acknowledged=bool(item.get("legalAcknowledged")),
        legal_acknowledged_at=_s(item.get("legalAcknowledgedAt")),
        legal_acknowledged_version=_s(item.get("legalAcknowledgedVersion")),
    )


def _s(v: Any) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def _profile_to_item(profile: UserProfile) -> dict[str, Any]:
    item: dict[str, Any] = {
        "userId": profile.user_id,
        "tradingMode": profile.trading_mode.value,
        "onboardingCompleted": profile.onboarding_completed,
        "legalAcknowledged": profile.legal_acknowledged,
    }
    if profile.email:
        item["email"] = profile.email
    if profile.onboarding_completed_at:
        item["onboardingCompletedAt"] = profile.onboarding_completed_at
    if profile.legal_acknowledged_at:
        item["legalAcknowledgedAt"] = profile.legal_acknowledged_at
    if profile.legal_acknowledged_version:
        item["legalAcknowledgedVersion"] = profile.legal_acknowledged_version
    return item


@dataclass
class InMemoryUserProfileStore:
    _profiles: dict[str, UserProfile] = field(default_factory=dict)

    def get_profile(self, user_id: str) -> UserProfile:
        return self._profiles.get(user_id) or UserProfile(user_id=user_id)

    def set_trading_mode(self, user_id: str, mode: TradingMode) -> None:
        cur = self.get_profile(user_id)
        self.put_profile(cur.model_copy(update={"trading_mode": mode}))

    def put_profile(self, profile: UserProfile) -> None:
        self._profiles[profile.user_id] = profile


@dataclass
class DynamoDBUserProfileStore:
    table: DynamoTableLike
    user_key: str = "userId"
    trading_mode_attr: str = "tradingMode"

    @classmethod
    def from_boto3_table(
        cls,
        *,
        table_name: str,
        dynamodb_resource: Any = None,
    ) -> "DynamoDBUserProfileStore":
        if dynamodb_resource is None:
            import boto3

            dynamodb_resource = boto3.resource("dynamodb")
        table = dynamodb_resource.Table(table_name)
        return cls(table=table)

    def get_profile(self, user_id: str) -> UserProfile:
        resp = self.table.get_item(Key={self.user_key: user_id})
        item = resp.get("Item") or {}
        if not item:
            return UserProfile(user_id=user_id)
        return _item_to_profile(user_id, item)

    def set_trading_mode(self, user_id: str, mode: TradingMode) -> None:
        cur = self.get_profile(user_id)
        self.put_profile(cur.model_copy(update={"trading_mode": mode}))

    def put_profile(self, profile: UserProfile) -> None:
        existing = self.table.get_item(Key={self.user_key: profile.user_id}).get("Item") or {}
        merged = {**existing, **_profile_to_item(profile)}
        self.table.put_item(Item=merged)


def build_default_user_profile_store() -> UserProfileStore:
    settings = get_settings()
    if settings.dynamodb_users_table:
        return DynamoDBUserProfileStore.from_boto3_table(table_name=settings.dynamodb_users_table)
    return InMemoryUserProfileStore()


_USER_PROFILE_STORE: UserProfileStore = build_default_user_profile_store()


def get_user_profile_store() -> UserProfileStore:
    return _USER_PROFILE_STORE
