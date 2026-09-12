"""Portfolio holdings persistence (DynamoDB in non-dev; in-memory in dev).

One item per user: ``{ userId, holdings: [ {symbol, lots:[...]} ] }`` — mirrors the
TradePlans store pattern. Holdings are deduped by symbol (one row per ticker; lots live
inside). This backs the manual portfolio the daily review reads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator, Protocol

from stocvest.models.portfolio_holding import (
    MAX_HOLDINGS_PER_USER,
    PortfolioHolding,
    PortfolioSettings,
    apply_stock_split,
)
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def scan(self, **kwargs: Any) -> dict[str, Any]: ...


class HoldingsStore(Protocol):
    def list_holdings(self, user_id: str) -> tuple[PortfolioHolding, ...]: ...
    def replace_all(self, user_id: str, holdings: tuple[PortfolioHolding, ...]) -> None: ...
    def upsert_holding(self, user_id: str, holding: PortfolioHolding) -> None: ...
    def remove_holding(self, user_id: str, symbol: str) -> bool: ...
    def get_settings(self, user_id: str) -> PortfolioSettings: ...
    def save_settings(self, user_id: str, settings: PortfolioSettings) -> None: ...
    def iter_users_with_holdings(self) -> Iterator[str]: ...
    def apply_split(self, user_id: str, symbol: str, ratio: float) -> PortfolioHolding | None: ...


def _dedupe(holdings: tuple[PortfolioHolding, ...]) -> tuple[PortfolioHolding, ...]:
    """One holding per symbol — last wins; capped and stably ordered by symbol."""
    by_symbol: dict[str, PortfolioHolding] = {}
    for h in holdings:
        by_symbol[h.symbol] = h
    ordered = sorted(by_symbol.values(), key=lambda h: h.symbol)
    return tuple(ordered[:MAX_HOLDINGS_PER_USER])


@dataclass
class InMemoryHoldingsStore:
    _by_user: dict[str, tuple[PortfolioHolding, ...]]
    _settings_by_user: dict[str, PortfolioSettings] = field(default_factory=dict)

    def list_holdings(self, user_id: str) -> tuple[PortfolioHolding, ...]:
        return self._by_user.get(user_id, ())

    def replace_all(self, user_id: str, holdings: tuple[PortfolioHolding, ...]) -> None:
        self._by_user[user_id] = _dedupe(holdings)

    def upsert_holding(self, user_id: str, holding: PortfolioHolding) -> None:
        rest = tuple(h for h in self.list_holdings(user_id) if h.symbol != holding.symbol)
        self._by_user[user_id] = _dedupe(rest + (holding,))

    def remove_holding(self, user_id: str, symbol: str) -> bool:
        sym = symbol.strip().upper()
        cur = self.list_holdings(user_id)
        nxt = tuple(h for h in cur if h.symbol != sym)
        if len(nxt) == len(cur):
            return False
        self._by_user[user_id] = nxt
        return True

    def get_settings(self, user_id: str) -> PortfolioSettings:
        return self._settings_by_user.get(user_id, PortfolioSettings())

    def save_settings(self, user_id: str, settings: PortfolioSettings) -> None:
        self._settings_by_user[user_id] = settings

    def iter_users_with_holdings(self) -> Iterator[str]:
        for uid, holdings in self._by_user.items():
            if holdings:
                yield uid

    def apply_split(self, user_id: str, symbol: str, ratio: float) -> PortfolioHolding | None:
        sym = symbol.strip().upper()
        held = next((h for h in self.list_holdings(user_id) if h.symbol == sym), None)
        if held is None:
            return None
        adjusted = apply_stock_split(held, ratio=ratio)
        self.upsert_holding(user_id, adjusted)
        return adjusted


@dataclass
class DynamoDBHoldingsStore:
    table: DynamoTableLike
    user_key: str = "userId"
    holdings_key: str = "holdings"
    settings_key: str = "settings"

    @classmethod
    def from_boto3_table(
        cls, *, table_name: str, dynamodb_resource: Any = None
    ) -> DynamoDBHoldingsStore:
        if dynamodb_resource is None:
            import boto3

            endpoint_url = get_settings().dynamodb_endpoint_url
            dynamodb_resource = (
                boto3.resource("dynamodb", endpoint_url=endpoint_url)
                if endpoint_url
                else boto3.resource("dynamodb")
            )
        table = dynamodb_resource.Table(table_name)
        return cls(table=table)

    def _get_item(self, user_id: str) -> dict[str, Any]:
        resp = self.table.get_item(Key={self.user_key: user_id})
        return resp.get("Item") or {}

    def _put_item(
        self,
        user_id: str,
        *,
        holdings: tuple[PortfolioHolding, ...],
        settings: PortfolioSettings,
    ) -> None:
        # One item per user carries both holdings and settings; always write both so a
        # holdings write never clobbers settings (and vice versa).
        self.table.put_item(
            Item={
                self.user_key: user_id,
                self.holdings_key: [h.to_dynamo_item() for h in holdings],
                self.settings_key: settings.to_dynamo_item(),
            }
        )

    @staticmethod
    def _holdings_from_item(item: dict[str, Any], holdings_key: str) -> tuple[PortfolioHolding, ...]:
        rows = item.get(holdings_key) or []
        holdings = [
            PortfolioHolding.from_dynamo_item(x) for x in rows if isinstance(x, dict)
        ]
        return _dedupe(tuple(holdings))

    def list_holdings(self, user_id: str) -> tuple[PortfolioHolding, ...]:
        return self._holdings_from_item(self._get_item(user_id), self.holdings_key)

    def replace_all(self, user_id: str, holdings: tuple[PortfolioHolding, ...]) -> None:
        item = self._get_item(user_id)
        settings = PortfolioSettings.from_dynamo_item(item.get(self.settings_key))
        self._put_item(user_id, holdings=_dedupe(holdings), settings=settings)

    def upsert_holding(self, user_id: str, holding: PortfolioHolding) -> None:
        item = self._get_item(user_id)
        settings = PortfolioSettings.from_dynamo_item(item.get(self.settings_key))
        current = self._holdings_from_item(item, self.holdings_key)
        rest = tuple(h for h in current if h.symbol != holding.symbol)
        self._put_item(user_id, holdings=_dedupe(rest + (holding,)), settings=settings)

    def remove_holding(self, user_id: str, symbol: str) -> bool:
        sym = symbol.strip().upper()
        item = self._get_item(user_id)
        settings = PortfolioSettings.from_dynamo_item(item.get(self.settings_key))
        current = self._holdings_from_item(item, self.holdings_key)
        nxt = tuple(h for h in current if h.symbol != sym)
        if len(nxt) == len(current):
            return False
        self._put_item(user_id, holdings=nxt, settings=settings)
        return True

    def get_settings(self, user_id: str) -> PortfolioSettings:
        return PortfolioSettings.from_dynamo_item(self._get_item(user_id).get(self.settings_key))

    def save_settings(self, user_id: str, settings: PortfolioSettings) -> None:
        item = self._get_item(user_id)
        holdings = self._holdings_from_item(item, self.holdings_key)
        self._put_item(user_id, holdings=holdings, settings=settings)

    def iter_users_with_holdings(self) -> Iterator[str]:
        """Scan the Holdings table, yielding userIds that have ≥1 holding.

        Used by the daily digest job. Projects only the key + holdings so the scan stays
        cheap; skips rows whose holdings list is empty/missing. Paginated over
        ``LastEvaluatedKey`` like the other user-scan jobs (`trial/user_directory.py`).
        """
        last_key: dict[str, Any] | None = None
        while True:
            kwargs: dict[str, Any] = {
                "ProjectionExpression": "#uid, #h",
                "ExpressionAttributeNames": {"#uid": self.user_key, "#h": self.holdings_key},
            }
            if last_key:
                kwargs["ExclusiveStartKey"] = last_key
            resp = self.table.scan(**kwargs)
            for item in resp.get("Items") or []:
                if not isinstance(item, dict):
                    continue
                uid = str(item.get(self.user_key) or "").strip()
                if uid and item.get(self.holdings_key):
                    yield uid
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break

    def apply_split(self, user_id: str, symbol: str, ratio: float) -> PortfolioHolding | None:
        sym = symbol.strip().upper()
        item = self._get_item(user_id)
        settings = PortfolioSettings.from_dynamo_item(item.get(self.settings_key))
        current = self._holdings_from_item(item, self.holdings_key)
        held = next((h for h in current if h.symbol == sym), None)
        if held is None:
            return None
        adjusted = apply_stock_split(held, ratio=ratio)
        rest = tuple(h for h in current if h.symbol != sym)
        self._put_item(user_id, holdings=_dedupe(rest + (adjusted,)), settings=settings)
        return adjusted


def build_default_holdings_store() -> HoldingsStore:
    settings = get_settings()
    if settings.holdings_table:
        return DynamoDBHoldingsStore.from_boto3_table(table_name=settings.holdings_table)
    if settings.is_development:
        return InMemoryHoldingsStore(_by_user={})
    raise ValueError(
        "STOCVEST_HOLDINGS_TABLE must be configured in non-development environments."
    )


_HOLDINGS_STORE: HoldingsStore | None = None


def get_holdings_store() -> HoldingsStore:
    global _HOLDINGS_STORE
    if _HOLDINGS_STORE is None:
        _HOLDINGS_STORE = build_default_holdings_store()
    return _HOLDINGS_STORE


def reset_holdings_store_for_tests() -> None:
    global _HOLDINGS_STORE
    _HOLDINGS_STORE = None
