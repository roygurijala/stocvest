"""Portfolio holdings persistence (DynamoDB in non-dev; in-memory in dev).

One item per user: ``{ userId, holdings: [ {symbol, lots:[...]} ] }`` — mirrors the
TradePlans store pattern. Holdings are deduped by symbol (one row per ticker; lots live
inside). This backs the manual portfolio the daily review reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from stocvest.models.portfolio_holding import MAX_HOLDINGS_PER_USER, PortfolioHolding
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


class HoldingsStore(Protocol):
    def list_holdings(self, user_id: str) -> tuple[PortfolioHolding, ...]: ...
    def replace_all(self, user_id: str, holdings: tuple[PortfolioHolding, ...]) -> None: ...
    def upsert_holding(self, user_id: str, holding: PortfolioHolding) -> None: ...
    def remove_holding(self, user_id: str, symbol: str) -> bool: ...


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


@dataclass
class DynamoDBHoldingsStore:
    table: DynamoTableLike
    user_key: str = "userId"
    holdings_key: str = "holdings"

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

    def list_holdings(self, user_id: str) -> tuple[PortfolioHolding, ...]:
        resp = self.table.get_item(Key={self.user_key: user_id})
        item = resp.get("Item")
        if not item:
            return ()
        rows = item.get(self.holdings_key) or []
        holdings = [
            PortfolioHolding.from_dynamo_item(x) for x in rows if isinstance(x, dict)
        ]
        return _dedupe(tuple(holdings))

    def replace_all(self, user_id: str, holdings: tuple[PortfolioHolding, ...]) -> None:
        deduped = _dedupe(holdings)
        self.table.put_item(
            Item={
                self.user_key: user_id,
                self.holdings_key: [h.to_dynamo_item() for h in deduped],
            }
        )

    def upsert_holding(self, user_id: str, holding: PortfolioHolding) -> None:
        rest = tuple(h for h in self.list_holdings(user_id) if h.symbol != holding.symbol)
        self.replace_all(user_id, rest + (holding,))

    def remove_holding(self, user_id: str, symbol: str) -> bool:
        sym = symbol.strip().upper()
        cur = self.list_holdings(user_id)
        nxt = tuple(h for h in cur if h.symbol != sym)
        if len(nxt) == len(cur):
            return False
        self.replace_all(user_id, nxt)
        return True


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
