"""Unit tests for the assistant watchlist intelligence context service."""

from __future__ import annotations

import pytest

from stocvest.api.services.assistant_watchlist_context import (
    fetch_watchlist_context,
    serialize_watchlist_context,
)
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.models.watchlist import WatchlistEntry, WatchlistState

_SVC = "stocvest.api.services.assistant_watchlist_context"


class _FakeRepo:
    def __init__(self, entries: dict[tuple[str, str, str], WatchlistEntry]) -> None:
        self._entries = entries

    def get_entry(self, user_id: str, symbol: str, mode: str) -> WatchlistEntry | None:
        return self._entries.get((user_id, symbol.upper(), mode))


def _entry(symbol: str, *, state: WatchlistState, layers: int) -> WatchlistEntry:
    return WatchlistEntry(
        user_id="u1",
        symbol=symbol,
        mode="day",
        state=state,
        previous_state=None,
        state_changed_at="2026-01-01T00:00:00+00:00",
        state_change_reason="x",
        layers_aligned=layers,
    )


def test_empty_watchlist_returns_empty_source(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()  # no watchlist created
    monkeypatch.setattr(f"{_SVC}.get_watchlist_store", lambda: store)
    monkeypatch.setattr(f"{_SVC}.get_watchlist_maturation_repository", lambda: _FakeRepo({}))

    ctx = fetch_watchlist_context("u1", "day")
    assert ctx.source == "empty_watchlist"
    block = serialize_watchlist_context(ctx)
    assert "empty_watchlist" in block


def test_storage_unavailable_when_repo_none(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL"], is_default=True)
    monkeypatch.setattr(f"{_SVC}.get_watchlist_store", lambda: store)
    monkeypatch.setattr(f"{_SVC}.get_watchlist_maturation_repository", lambda: None)

    ctx = fetch_watchlist_context("u1", "day")
    assert ctx.source == "storage_unavailable"


def test_ranks_opportunities_closest_to_actionable_first(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL", "NVDA", "TSLA"], is_default=True)
    entries = {
        ("u1", "AAPL", "day"): _entry("AAPL", state=WatchlistState.DEVELOPING, layers=3),
        ("u1", "NVDA", "day"): _entry("NVDA", state=WatchlistState.ACTIONABLE, layers=6),
        ("u1", "TSLA", "day"): _entry("TSLA", state=WatchlistState.DEVELOPING, layers=4),
    }
    monkeypatch.setattr(f"{_SVC}.get_watchlist_store", lambda: store)
    monkeypatch.setattr(f"{_SVC}.get_watchlist_maturation_repository", lambda: _FakeRepo(entries))

    ctx = fetch_watchlist_context("u1", "day")
    assert ctx.source == "ok"
    assert ctx.total_symbols == 3
    assert ctx.evaluated_count == 3
    assert ctx.actionable_count == 1
    assert ctx.near_ready_count == 1
    assert ctx.developing_count == 1
    # NVDA (actionable) must rank first; AAPL (developing) last.
    assert ctx.opportunities[0].symbol == "NVDA"
    assert ctx.opportunities[-1].symbol == "AAPL"

    block = serialize_watchlist_context(ctx)
    assert "WATCHLIST CONTEXT" in block
    assert "NVDA" in block
    # Never instruct buy/sell directly.
    assert "Do NOT issue buy/sell calls" in block
