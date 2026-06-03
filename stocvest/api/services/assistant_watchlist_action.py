"""
Watchlist action service for the STOCVEST Assistant.

Handles "add X to my watchlist" / "remove X from my watchlist" intents detected
in the assistant conversation. Executes the mutation synchronously and returns
a structured result the handler can attach to the response.

Design notes:
- Only the user's *default* watchlist is targeted. Users with multiple named
  watchlists should use the Watchlists page for targeted management.
- Symbol validation is deferred to the store layer (if the symbol doesn't exist
  as a valid ticker, the store still writes it — the signal engine will simply
  produce no analysis for it). Strict validation would require a Polygon call
  and adds latency; a user who accidentally types a typo will see no signals
  for it and will notice quickly.
- add_symbol is idempotent (adding an already-present symbol is a no-op that
  returns the existing watchlist).
"""

from __future__ import annotations

from dataclasses import dataclass

from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Per-user default watchlist symbol cap kept in sync with the plan-tier cap used
# elsewhere (the store enforces this on write, but we can give a friendly
# pre-flight message).
_DEFAULT_MAX_SYMBOLS = 50


@dataclass(frozen=True)
class WatchlistActionResult:
    success: bool
    action_type: str          # "watchlist_add" | "watchlist_remove"
    symbol: str
    message: str              # human-readable confirmation or error


def execute_watchlist_add(user_id: str, symbol: str) -> WatchlistActionResult:
    """Add *symbol* to the user's default watchlist.

    Creates a default watchlist if the user has none.  Returns a structured
    result suitable for inclusion in the assistant response.
    """
    sym = symbol.strip().upper()
    if not sym:
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_add",
            symbol=symbol,
            message="I couldn't identify a valid stock symbol to add.",
        )

    try:
        store = get_watchlist_store()
        wl = store.get_default_watchlist(user_id)

        if wl is None:
            # Create a default watchlist if the user has none.
            wl = store.create_watchlist(
                user_id=user_id,
                name="My Watchlist",
                is_default=True,
            )
            if wl is None:
                raise RuntimeError("create_watchlist returned None")

        # Check if already present (idempotent add).
        if wl.symbols and sym in {s.upper() for s in wl.symbols}:
            return WatchlistActionResult(
                success=True,
                action_type="watchlist_add",
                symbol=sym,
                message=f"{sym} is already on your watchlist.",
            )

        updated = store.add_symbol(
            user_id=user_id,
            watchlist_id=wl.watchlist_id,
            symbol=sym,
            track_swing=True,
            track_day=True,
            max_symbols=_DEFAULT_MAX_SYMBOLS,
        )
        if updated is None:
            return WatchlistActionResult(
                success=False,
                action_type="watchlist_add",
                symbol=sym,
                message=f"Couldn't add {sym} — your watchlist may be full (max {_DEFAULT_MAX_SYMBOLS} symbols).",
            )

        return WatchlistActionResult(
            success=True,
            action_type="watchlist_add",
            symbol=sym,
            message=f"Added {sym} to your watchlist.",
        )

    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_watchlist_add failed for %s/%s: %s", user_id, sym, exc)
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_add",
            symbol=sym,
            message=f"Couldn't add {sym} to your watchlist right now. Try again in a moment.",
        )


def execute_watchlist_remove(user_id: str, symbol: str) -> WatchlistActionResult:
    """Remove *symbol* from the user's default watchlist."""
    sym = symbol.strip().upper()
    if not sym:
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_remove",
            symbol=symbol,
            message="I couldn't identify a valid stock symbol to remove.",
        )

    try:
        store = get_watchlist_store()
        wl = store.get_default_watchlist(user_id)

        if wl is None:
            return WatchlistActionResult(
                success=False,
                action_type="watchlist_remove",
                symbol=sym,
                message=f"You don't have a default watchlist yet, so {sym} isn't on it.",
            )

        updated = store.remove_symbol(
            user_id=user_id,
            watchlist_id=wl.watchlist_id,
            symbol=sym,
        )
        if updated is None:
            return WatchlistActionResult(
                success=False,
                action_type="watchlist_remove",
                symbol=sym,
                message=f"{sym} wasn't found on your watchlist.",
            )

        return WatchlistActionResult(
            success=True,
            action_type="watchlist_remove",
            symbol=sym,
            message=f"Removed {sym} from your watchlist.",
        )

    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_watchlist_remove failed for %s/%s: %s", user_id, sym, exc)
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_remove",
            symbol=sym,
            message=f"Couldn't remove {sym} right now. Try again in a moment.",
        )
