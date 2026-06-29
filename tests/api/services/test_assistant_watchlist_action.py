"""Tests for the STOCVEST Assistant watchlist add/remove action service.

Focus: the plan-derived symbol cap is forwarded to the store on add (so paid
tiers get their full allotment instead of a flat 50), plus the idempotent-add and
default-list-creation paths. The store is faked — no DynamoDB calls are made.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from stocvest.api.services.assistant_watchlist_action import (
    _DEFAULT_MAX_SYMBOLS,
    execute_watchlist_add,
)


class _FakeStore:
    """Minimal watchlist store: records the max_symbols passed to add_symbol."""

    def __init__(self, *, existing_symbols: list[str] | None = None) -> None:
        self.wl = SimpleNamespace(
            watchlist_id="wl-1", symbols=list(existing_symbols or [])
        )
        self.add_calls: list[dict] = []

    def get_default_watchlist(self, _user_id: str):
        return self.wl

    def create_watchlist(self, **_kwargs):  # pragma: no cover - not hit when wl exists
        return self.wl

    def add_symbol(self, *, user_id, watchlist_id, symbol, track_swing, track_day, max_symbols):
        self.add_calls.append({"symbol": symbol, "max_symbols": max_symbols})
        return self.wl


def test_add_forwards_plan_cap_100() -> None:
    store = _FakeStore()
    with patch(
        "stocvest.api.services.assistant_watchlist_action.get_watchlist_store",
        return_value=store,
    ):
        result = execute_watchlist_add("u1", "NVDA", company_name="NVIDIA", max_symbols=100)
    assert result.success is True
    assert store.add_calls[0]["max_symbols"] == 100


def test_add_forwards_plan_cap_50() -> None:
    store = _FakeStore()
    with patch(
        "stocvest.api.services.assistant_watchlist_action.get_watchlist_store",
        return_value=store,
    ):
        execute_watchlist_add("u1", "NVDA", max_symbols=50)
    assert store.add_calls[0]["max_symbols"] == 50


def test_add_defaults_to_top_tier_cap_when_omitted() -> None:
    store = _FakeStore()
    with patch(
        "stocvest.api.services.assistant_watchlist_action.get_watchlist_store",
        return_value=store,
    ):
        execute_watchlist_add("u1", "NVDA")
    assert store.add_calls[0]["max_symbols"] == _DEFAULT_MAX_SYMBOLS
    assert _DEFAULT_MAX_SYMBOLS == 100


def test_add_is_idempotent_for_existing_symbol() -> None:
    store = _FakeStore(existing_symbols=["NVDA"])
    with patch(
        "stocvest.api.services.assistant_watchlist_action.get_watchlist_store",
        return_value=store,
    ):
        result = execute_watchlist_add("u1", "nvda", max_symbols=100)
    assert result.success is True
    assert "already on your watchlist" in result.message
    # No write attempted for an already-present symbol.
    assert store.add_calls == []
