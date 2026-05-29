"""Bounded gap-intelligence symbol universe."""

from __future__ import annotations

from stocvest.data.scan_symbols import BOUNDED_SCAN_MAX_SYMBOLS, get_scan_symbols
from stocvest.data.watchlist_store import InMemoryWatchlistStore


def test_get_scan_symbols_includes_dell_from_liquid_fallback() -> None:
    merged = get_scan_symbols(None, None)
    assert "DELL" in merged
    assert len(merged) <= BOUNDED_SCAN_MAX_SYMBOLS


def test_watchlist_symbols_precede_liquid_list() -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["ZZTOP"], is_default=True)
    merged = get_scan_symbols("u1", store)
    assert merged[0] == "ZZTOP"
