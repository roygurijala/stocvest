"""
Watchlist intelligence context for the STOCVEST Assistant.

Summarizes the user's *default* watchlist using only cached maturation data
(the same point-read path the ``/v1/watchlists/maturation-summary`` endpoint
uses) so questions like:

  - "how is my watchlist doing today?"
  - "what are the best opportunities from my watchlist?"

can be answered with concrete, current internal state — without triggering any
expensive per-symbol recompute. The serialized block is appended to the
assistant system prompt; STOCVEST's gating logic remains authoritative and the
assistant never invents per-symbol trade advice.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.models.watchlist import WatchlistEntry, WatchlistMode, derive_progress_band
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Order used to rank "opportunities" — closest to actionable first.
_BAND_RANK: dict[str, int] = {
    "actionable": 0,
    "near_ready": 1,
    "developing": 2,
    "not_aligned": 3,
}

_MAX_OPPORTUNITIES = 6


@dataclass
class WatchlistOpportunity:
    symbol: str
    label: str
    bias: str
    layers_aligned: int
    layers_total: int
    progress_band: str


@dataclass
class WatchlistContext:
    # status: ok | empty_watchlist | storage_unavailable | error
    source: str = "ok"
    mode: WatchlistMode = "day"
    total_symbols: int = 0
    evaluated_count: int = 0
    actionable_count: int = 0
    near_ready_count: int = 0
    developing_count: int = 0
    not_aligned_count: int = 0
    opportunities: list[WatchlistOpportunity] = field(default_factory=list)
    has_data: bool = False


def fetch_watchlist_context(user_id: str, mode: WatchlistMode = "day") -> WatchlistContext:
    """Build a watchlist summary from cached maturation entries (point reads)."""
    ctx = WatchlistContext(mode=mode)
    if not user_id:
        ctx.source = "error"
        return ctx

    try:
        repo = get_watchlist_maturation_repository()
        if repo is None:
            ctx.source = "storage_unavailable"
            return ctx

        wl = get_watchlist_store().get_default_watchlist(user_id)
        if not wl or not wl.symbols:
            ctx.source = "empty_watchlist"
            return ctx

        symbols = [s.strip().upper() for s in wl.symbols if str(s).strip()]
        ctx.total_symbols = len(symbols)

        entries: list[WatchlistEntry] = []
        for sym in symbols:
            try:
                hit = repo.get_entry(user_id, sym, mode)
            except Exception as exc:  # noqa: BLE001 — one bad symbol must not break the summary
                _LOG.debug("assistant_watchlist_context get_entry failed %s/%s: %s", user_id, sym, exc)
                continue
            if hit is not None and not hit.should_exclude_from_active_queries():
                entries.append(hit)

        ctx.evaluated_count = len(entries)
        opportunities: list[WatchlistOpportunity] = []
        for e in entries:
            band = derive_progress_band(e.layers_aligned, state=e.state)
            if band == "actionable":
                ctx.actionable_count += 1
            elif band == "near_ready":
                ctx.near_ready_count += 1
            elif band == "developing":
                ctx.developing_count += 1
            else:
                ctx.not_aligned_count += 1
            opportunities.append(
                WatchlistOpportunity(
                    symbol=e.symbol.strip().upper(),
                    label=e.label,
                    bias=e.bias,
                    layers_aligned=e.layers_aligned,
                    layers_total=e.layers_total,
                    progress_band=band,
                )
            )

        # Rank closest-to-actionable first, then by layers aligned, then symbol.
        opportunities.sort(
            key=lambda o: (_BAND_RANK.get(o.progress_band, 9), -o.layers_aligned, o.symbol)
        )
        ctx.opportunities = opportunities[:_MAX_OPPORTUNITIES]
        ctx.has_data = ctx.evaluated_count > 0 or ctx.total_symbols > 0
        return ctx

    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_watchlist_context fetch failed user=%s mode=%s: %s", user_id, mode, exc)
        ctx.source = "error"
        return ctx


def serialize_watchlist_context(ctx: WatchlistContext) -> str:
    """Render a compact context block for Claude. Empty string when no data."""
    if ctx.source == "empty_watchlist":
        return (
            "=== WATCHLIST CONTEXT ===\n"
            "source=empty_watchlist\n"
            "note=The user has no symbols on their default watchlist. Invite them to add some "
            "from the Watchlists or Scanner pages.\n"
        )
    if not ctx.has_data:
        return ""

    lines: list[str] = ["=== WATCHLIST CONTEXT ==="]
    lines.append(f"mode={ctx.mode}")
    lines.append(f"total_symbols={ctx.total_symbols}")
    lines.append(f"evaluated_with_maturation_data={ctx.evaluated_count}")
    lines.append(
        "band_counts="
        f"actionable={ctx.actionable_count},"
        f"near_ready={ctx.near_ready_count},"
        f"developing={ctx.developing_count},"
        f"not_aligned={ctx.not_aligned_count}"
    )
    if ctx.opportunities:
        lines.append("ranked_opportunities (closest-to-actionable first):")
        for o in ctx.opportunities:
            lines.append(
                f"- {o.symbol}: band={o.progress_band}, bias={o.bias}, "
                f"aligned={o.layers_aligned}/{o.layers_total}, status={o.label}"
            )
    if ctx.evaluated_count == 0:
        lines.append(
            "note=No maturation data has been computed for these symbols yet. Suggest opening "
            "the Watchlists page or running the scanner so STOCVEST can evaluate them."
        )
    lines.append(
        "guidance=Summarize plainly. Do NOT issue buy/sell calls. Point the user to the "
        "Signals page for any symbol they want to act on; STOCVEST's gating is authoritative."
    )
    lines.append("")
    return "\n".join(lines)
