"""
Watchlist action service for the STOCVEST Assistant.

Handles "add X to my watchlist" / "remove X from my watchlist" intents detected
in the assistant conversation. Executes the mutation synchronously and returns
a structured result the handler can attach to the response.

Design notes:
- Only the user's *default* watchlist is targeted. Users with multiple named
  watchlists should use the Watchlists page for targeted management.
- Symbol validation happens in the chat handler via
  :func:`stocvest.api.services.symbol_resolver.resolve_symbol` *before* this
  service is called, so an unknown ticker never reaches the store. The resolved
  company name is threaded through here purely for a friendlier confirmation
  ("Added NVDA (NVIDIA Corp) to your watchlist.").
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
    company_name: str | None = None  # resolved name, for display next to the ticker


def _with_name(sym: str, company_name: str | None) -> str:
    """Return ``AAPL (Apple Inc.)`` when a name is known, else just the ticker."""
    name = (company_name or "").strip()
    return f"{sym} ({name})" if name else sym


def execute_watchlist_add(
    user_id: str,
    symbol: str,
    *,
    company_name: str | None = None,
) -> WatchlistActionResult:
    """Add *symbol* to the user's default watchlist.

    Creates a default watchlist if the user has none.  Returns a structured
    result suitable for inclusion in the assistant response. *company_name*, when
    provided by the caller's symbol resolution, is echoed in the confirmation and
    on the result for display next to the ticker.
    """
    sym = symbol.strip().upper()
    if not sym:
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_add",
            symbol=symbol,
            message="I couldn't identify a valid stock symbol to add.",
        )
    label = _with_name(sym, company_name)

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
                message=f"{label} is already on your watchlist.",
                company_name=company_name,
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
                message=f"Couldn't add {label} — your watchlist may be full (max {_DEFAULT_MAX_SYMBOLS} symbols).",
                company_name=company_name,
            )

        return WatchlistActionResult(
            success=True,
            action_type="watchlist_add",
            symbol=sym,
            message=f"Added {label} to your watchlist.",
            company_name=company_name,
        )

    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_watchlist_add failed for %s/%s: %s", user_id, sym, exc)
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_add",
            symbol=sym,
            message=f"Couldn't add {label} to your watchlist right now. Try again in a moment.",
            company_name=company_name,
        )


def execute_watchlist_remove(
    user_id: str,
    symbol: str,
    *,
    company_name: str | None = None,
) -> WatchlistActionResult:
    """Remove *symbol* from the user's default watchlist."""
    sym = symbol.strip().upper()
    if not sym:
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_remove",
            symbol=symbol,
            message="I couldn't identify a valid stock symbol to remove.",
        )
    label = _with_name(sym, company_name)

    try:
        store = get_watchlist_store()
        wl = store.get_default_watchlist(user_id)

        if wl is None:
            return WatchlistActionResult(
                success=False,
                action_type="watchlist_remove",
                symbol=sym,
                message=f"You don't have a default watchlist yet, so {label} isn't on it.",
                company_name=company_name,
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
                message=f"{label} wasn't found on your watchlist.",
                company_name=company_name,
            )

        return WatchlistActionResult(
            success=True,
            action_type="watchlist_remove",
            symbol=sym,
            message=f"Removed {label} from your watchlist.",
            company_name=company_name,
        )

    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_watchlist_remove failed for %s/%s: %s", user_id, sym, exc)
        return WatchlistActionResult(
            success=False,
            action_type="watchlist_remove",
            symbol=sym,
            message=f"Couldn't remove {label} right now. Try again in a moment.",
            company_name=company_name,
        )
