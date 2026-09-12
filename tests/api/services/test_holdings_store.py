from __future__ import annotations

import pytest

from stocvest.api.services.holdings_store import (
    DynamoDBHoldingsStore,
    InMemoryHoldingsStore,
)
from stocvest.models.portfolio_holding import PortfolioHolding, PortfolioSettings

pytestmark = pytest.mark.unit


def _holding(symbol: str, *, qty: float = 10, cost: float = 100.0) -> PortfolioHolding:
    return PortfolioHolding.from_api(
        {
            "symbol": symbol,
            "lots": [
                {
                    "lotId": f"{symbol}-l1",
                    "quantity": qty,
                    "costBasis": cost,
                    "purchaseDate": "2024-01-15",
                }
            ],
        }
    )


def test_upsert_list_and_remove() -> None:
    store = InMemoryHoldingsStore(_by_user={})
    store.upsert_holding("u1", _holding("AAPL"))
    store.upsert_holding("u1", _holding("MSFT"))
    symbols = [h.symbol for h in store.list_holdings("u1")]
    assert symbols == ["AAPL", "MSFT"]  # sorted by symbol

    assert store.remove_holding("u1", "aapl") is True
    assert [h.symbol for h in store.list_holdings("u1")] == ["MSFT"]
    assert store.remove_holding("u1", "AAPL") is False


def test_upsert_same_symbol_replaces_lots() -> None:
    store = InMemoryHoldingsStore(_by_user={})
    store.upsert_holding("u1", _holding("AAPL", qty=10, cost=100.0))
    store.upsert_holding("u1", _holding("AAPL", qty=25, cost=150.0))
    holdings = store.list_holdings("u1")
    assert len(holdings) == 1
    assert holdings[0].total_quantity == 25


def test_replace_all_dedupes_by_symbol() -> None:
    store = InMemoryHoldingsStore(_by_user={})
    store.replace_all(
        "u1",
        (_holding("AAPL", qty=10), _holding("AAPL", qty=99), _holding("TSLA")),
    )
    holdings = {h.symbol: h for h in store.list_holdings("u1")}
    assert set(holdings) == {"AAPL", "TSLA"}
    assert holdings["AAPL"].total_quantity == 99  # last wins


def test_users_are_isolated() -> None:
    store = InMemoryHoldingsStore(_by_user={})
    store.upsert_holding("u1", _holding("AAPL"))
    assert store.list_holdings("u2") == ()


def test_settings_default_and_roundtrip_in_memory() -> None:
    store = InMemoryHoldingsStore(_by_user={})
    assert store.get_settings("u1") == PortfolioSettings()  # defaults
    store.save_settings(
        "u1", PortfolioSettings(cash_balance=5000.0, target_position_pct=5.0, benchmark_symbol="QQQ")
    )
    got = store.get_settings("u1")
    assert got.cash_balance == 5000.0
    assert got.target_position_pct == 5.0
    assert got.benchmark_symbol == "QQQ"


class _FakeTable:
    """Minimal DynamoDB table double: a single-item store keyed by userId."""

    def __init__(self) -> None:
        self._items: dict[str, dict] = {}

    def get_item(self, *, Key: dict) -> dict:
        item = self._items.get(Key["userId"])
        return {"Item": item} if item is not None else {}

    def put_item(self, *, Item: dict) -> dict:
        self._items[Item["userId"]] = Item
        return {}


def test_dynamo_settings_and_holdings_do_not_clobber_each_other() -> None:
    store = DynamoDBHoldingsStore(table=_FakeTable())
    # Write holdings first, then settings — settings write must preserve holdings.
    store.upsert_holding("u1", _holding("AAPL"))
    store.save_settings("u1", PortfolioSettings(cash_balance=2500.0, target_position_pct=8.0))
    assert [h.symbol for h in store.list_holdings("u1")] == ["AAPL"]
    assert store.get_settings("u1").cash_balance == 2500.0

    # Now mutate holdings — settings must survive.
    store.upsert_holding("u1", _holding("MSFT"))
    assert store.get_settings("u1").cash_balance == 2500.0
    assert [h.symbol for h in store.list_holdings("u1")] == ["AAPL", "MSFT"]

    # And removing a holding preserves settings too.
    assert store.remove_holding("u1", "AAPL") is True
    assert store.get_settings("u1").target_position_pct == 8.0
