"""User profile fields (trading mode) — DynamoDB or in-memory."""

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


@dataclass
class InMemoryUserProfileStore:
    _profiles: dict[str, UserProfile] = field(default_factory=dict)

    def get_profile(self, user_id: str) -> UserProfile:
        return self._profiles.get(user_id) or UserProfile(user_id=user_id)

    def set_trading_mode(self, user_id: str, mode: TradingMode) -> None:
        cur = self.get_profile(user_id)
        self._profiles[user_id] = UserProfile(user_id=user_id, trading_mode=mode)


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
        item = resp.get("Item")
        if not item:
            return UserProfile(user_id=user_id)
        raw = item.get(self.trading_mode_attr)
        mode = TradingMode.PAPER
        if raw is not None:
            try:
                mode = TradingMode(str(raw).lower())
            except ValueError:
                mode = TradingMode.PAPER
        return UserProfile(user_id=user_id, trading_mode=mode)

    def set_trading_mode(self, user_id: str, mode: TradingMode) -> None:
        existing = self.table.get_item(Key={self.user_key: user_id}).get("Item") or {}
        existing[self.user_key] = user_id
        existing[self.trading_mode_attr] = mode.value
        self.table.put_item(Item=existing)


def build_default_user_profile_store() -> UserProfileStore:
    settings = get_settings()
    if settings.dynamodb_users_table:
        return DynamoDBUserProfileStore.from_boto3_table(table_name=settings.dynamodb_users_table)
    return InMemoryUserProfileStore()


_USER_PROFILE_STORE: UserProfileStore = build_default_user_profile_store()


def get_user_profile_store() -> UserProfileStore:
    return _USER_PROFILE_STORE
