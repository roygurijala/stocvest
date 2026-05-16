"""User desk tracking preferences on the default watchlist (presentation + alerts only)."""

from __future__ import annotations

from stocvest.data.watchlist_store import WatchlistItem
from stocvest.models.watchlist import WatchlistMode


def is_desk_tracked_for_symbol(wl: WatchlistItem | None, symbol: str, mode: WatchlistMode) -> bool:
    """Return whether the user wants to observe ``mode`` for ``symbol`` on this watchlist.

    Evaluation/maturation refresh always runs; this gate applies to alerts and UI lenses only.
  """
    if wl is None:
        return True
    sym = str(symbol or "").strip().upper()
    if not sym:
        return True
    on_list = {str(s).strip().upper() for s in wl.symbols}
    if sym not in on_list:
        return True
    tracking = wl.tracking_for_symbol(sym)
    return bool(tracking.get("swing" if mode == "swing" else "day", True))
