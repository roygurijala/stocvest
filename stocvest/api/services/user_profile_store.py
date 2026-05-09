"""User profile fields (trading mode, onboarding, legal ack) — DynamoDB or in-memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from stocvest.data.models import TradingMode, UserProfile
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def scan(self, **kwargs: Any) -> dict[str, Any]: ...


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
    raw_plan = item.get("subscriptionPlan")
    subscription_plan = str(raw_plan).strip() if raw_plan is not None else "free"
    return UserProfile(
        user_id=user_id,
        email=email,
        trading_mode=mode,
        onboarding_completed=bool(item.get("onboardingCompleted")),
        onboarding_completed_at=_s(item.get("onboardingCompletedAt")),
        legal_acknowledged=bool(item.get("legalAcknowledged")),
        legal_acknowledged_at=_s(item.get("legalAcknowledgedAt")),
        legal_acknowledged_version=_s(item.get("legalAcknowledgedVersion")),
        subscription_plan=subscription_plan,
        beta_full_access=bool(item.get("betaFullAccess")),
        beta_access_until=_s(item.get("betaAccessUntil")),
        beta_access_granted_at=_s(item.get("betaAccessGrantedAt")),
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
        "subscriptionPlan": profile.subscription_plan,
        "betaFullAccess": bool(profile.beta_full_access),
    }
    if profile.email:
        item["email"] = profile.email
    if profile.onboarding_completed_at:
        item["onboardingCompletedAt"] = profile.onboarding_completed_at
    if profile.legal_acknowledged_at:
        item["legalAcknowledgedAt"] = profile.legal_acknowledged_at
    if profile.legal_acknowledged_version:
        item["legalAcknowledgedVersion"] = profile.legal_acknowledged_version
    if profile.beta_access_until:
        item["betaAccessUntil"] = profile.beta_access_until
    if profile.beta_access_granted_at:
        item["betaAccessGrantedAt"] = profile.beta_access_granted_at
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
        # Merged overwrite skips absent keys; explicitly drop beta window attrs when cleared.
        if not (profile.beta_access_until or "").strip():
            merged.pop("betaAccessUntil", None)
        if not (profile.beta_access_granted_at or "").strip():
            merged.pop("betaAccessGrantedAt", None)
        self.table.put_item(Item=merged)


def build_default_user_profile_store() -> UserProfileStore:
    settings = get_settings()
    if settings.dynamodb_users_table:
        return DynamoDBUserProfileStore.from_boto3_table(table_name=settings.dynamodb_users_table)
    return InMemoryUserProfileStore()


_USER_PROFILE_STORE: UserProfileStore | None = None


def get_user_profile_store() -> UserProfileStore:
    """Lazily construct the store so importing handlers does not call boto3 (Windows WMI / Py3.14 noise in pytest)."""
    global _USER_PROFILE_STORE
    if _USER_PROFILE_STORE is None:
        _USER_PROFILE_STORE = build_default_user_profile_store()
    return _USER_PROFILE_STORE


def reset_user_profile_store_for_tests() -> None:
    """Drop cached store after env/settings change (tests)."""
    global _USER_PROFILE_STORE
    _USER_PROFILE_STORE = None


def _is_founding_plan(plan: str) -> bool:
    p = (plan or "").strip().lower()
    # Shared founding counter is only for paid subscriptions.
    # Free users must never affect this count.
    return p in {
        "swing_pro",
        "swing_day_pro",
        # keep legacy aliases if older rows exist
        "founding_swing_pro",
        "founding_swing_day_pro",
    }


def get_founding_member_count() -> int:
    """
    Best-effort founding-member usage count for landing pricing.

    Counts users in plans that represent founding/pro paid tiers. Returns 0 on
    store errors so callers can gracefully fallback in UI copy.
    """
    store = get_user_profile_store()
    try:
        if isinstance(store, InMemoryUserProfileStore):
            return sum(1 for p in store._profiles.values() if _is_founding_plan(p.subscription_plan))
        if isinstance(store, DynamoDBUserProfileStore):
            count = 0
            last_key: dict[str, Any] | None = None
            while True:
                kwargs: dict[str, Any] = {"ProjectionExpression": "subscriptionPlan"}
                if last_key:
                    kwargs["ExclusiveStartKey"] = last_key
                resp = store.table.scan(**kwargs)
                items = resp.get("Items") or []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    if _is_founding_plan(str(item.get("subscriptionPlan") or "")):
                        count += 1
                last_key = resp.get("LastEvaluatedKey")
                if not last_key:
                    break
            return count
    except Exception:
        return 0
    return 0
