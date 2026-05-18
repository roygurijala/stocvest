"""Platform-wide setup behavior aggregates (admin, GSI-backed)."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.analytics.evolution_stats import compute_evolution_summary
from stocvest.analytics.outcome_stats import aggregate_outcome_stats, build_outcome_events
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


def aggregate_platform_behavior(
    transitions: list[WatchlistMaturationTransition],
    *,
    mode: Literal["swing", "day"],
    days: int,
) -> dict[str, Any]:
    """Roll up transition log rows across all users for a desk mode."""
    users = {t.user_id for t in transitions if t.user_id}
    symbols = {t.symbol.upper() for t in transitions if t.symbol}
    summary = compute_evolution_summary(transitions)

    by_user_sym: dict[tuple[str, str], list[WatchlistMaturationTransition]] = {}
    for t in transitions:
        by_user_sym.setdefault((t.user_id, t.symbol.upper()), []).append(t)

    events = []
    for (_uid, sym), rows in by_user_sym.items():
        events.extend(build_outcome_events(sym, mode, rows))

    stats = aggregate_outcome_stats(events)
    stats["unique_users"] = len(users)
    stats["unique_symbols"] = len(symbols)

    return {
        "mode": mode,
        "days": days,
        "scope": "platform",
        "transition_count": len(transitions),
        "unique_users": len(users),
        "unique_symbols": len(symbols),
        "evolution_summary": summary,
        "outcome_stats": stats,
        "note": (
            "Counts include transitions logged with ModeTimelineIndex (post-GSI deploy). "
            "Older rows without gsi1pk are excluded until re-logged."
            if len(transitions) == 0
            else None
        ),
    }
