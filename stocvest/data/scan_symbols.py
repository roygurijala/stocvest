"""Resolve scanner / morning-brief symbol universe from watchlists + system defaults."""

from __future__ import annotations

from typing import TYPE_CHECKING

from stocvest.utils.logging import get_logger

if TYPE_CHECKING:
    from stocvest.data.watchlist_store import WatchlistStore

_LOG = get_logger(__name__)

SYSTEM_DEFAULTS: list[str] = [
    "SPY",
    "QQQ",
    "AAPL",
    "NVDA",
    "TSLA",
    "MSFT",
    "AMZN",
    "META",
    "AMD",
    "GOOGL",
]


def get_scan_symbols(user_id: str | None, watchlist_store: WatchlistStore | None) -> list[str]:
    """
    Symbols to scan for gap intelligence / morning brief snapshots.
    Priority: authenticated user's default watchlist merged with system defaults (max 20),
    else system defaults.
    """
    if not user_id or watchlist_store is None:
        return list(SYSTEM_DEFAULTS)
    try:
        wl = watchlist_store.get_default_watchlist(user_id)
        if wl and wl.symbols:
            merged = list(dict.fromkeys([s.upper() for s in wl.symbols if s] + SYSTEM_DEFAULTS))
            return merged[:20]
    except Exception as exc:  # noqa: BLE001 — never break scanner on watchlist errors
        _LOG.warning("Watchlist fetch failed for scan symbols user=%s: %s", user_id, exc)
    return list(SYSTEM_DEFAULTS)
