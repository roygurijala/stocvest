"""Resolve scanner / gap-intelligence symbol universe from watchlists + liquid fallback."""

from __future__ import annotations

from typing import TYPE_CHECKING

from stocvest.data.scanner_universe import LIQUID_SYMBOLS_FALLBACK
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

if TYPE_CHECKING:
    from stocvest.data.watchlist_store import WatchlistStore

_LOG = get_logger(__name__)

# Legacy name kept for scheduled-scan docs; liquid fallback supersedes this short list.
SYSTEM_DEFAULTS: list[str] = list(LIQUID_SYMBOLS_FALLBACK[:12])

# Bounded gap-intelligence / Polygon batch path when full US snapshot times out.
BOUNDED_SCAN_MAX_SYMBOLS = 120


def get_scan_symbols(user_id: str | None, watchlist_store: WatchlistStore | None) -> list[str]:
    """
    Symbols for bounded gap-intelligence snapshots and Polygon tier fallback.

    Watchlist symbols are merged first, then the liquid fallback universe (~90+ names
    including DELL, CRWD, PLTR). Capped at ``BOUNDED_SCAN_MAX_SYMBOLS``.
    """
    liquid = [s.strip().upper() for s in LIQUID_SYMBOLS_FALLBACK if s and str(s).strip()]
    if not user_id or watchlist_store is None:
        return liquid[:BOUNDED_SCAN_MAX_SYMBOLS]

    watchlist: list[str] = []
    try:
        wl = watchlist_store.get_default_watchlist(user_id)
        if wl and wl.symbols:
            watchlist = [s.strip().upper() for s in wl.symbols if s and str(s).strip()]
    except Exception as exc:  # noqa: BLE001 — never break scanner on watchlist errors
        _LOG.warning("Watchlist fetch failed for scan symbols user=%s: %s", user_ref_for_logs(user_id), exc)

    merged: list[str] = []
    seen: set[str] = set()
    for sym in [*watchlist, *liquid]:
        if not sym or sym in seen:
            continue
        seen.add(sym)
        merged.append(sym)
        if len(merged) >= BOUNDED_SCAN_MAX_SYMBOLS:
            break
    return merged
