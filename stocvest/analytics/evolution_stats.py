"""Aggregate stats from watchlist maturation transition timelines."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Sequence

from stocvest.models.watchlist_transition import WatchlistMaturationTransition

_EMPTY_SUMMARY: dict[str, Any] = {
    "days_tracked": 0,
    "first_session": None,
    "last_session": None,
    "state_distribution": {},
    "alignment_trend": [],
    "transition_counts": {"initial": 0, "improved": 0, "worsened": 0, "unchanged": 0},
    "latest_state": None,
    "latest_layers_aligned": None,
}


def _parse_session_date(raw: str) -> date | None:
    s = (raw or "").strip()[:10]
    if len(s) != 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def compute_evolution_summary(
    transitions: Sequence[WatchlistMaturationTransition],
    *,
    max_alignment_points: int = 30,
) -> dict[str, Any]:
    """Summarize a symbol-mode transition list (chronological or reverse — normalized internally)."""
    if not transitions:
        return dict(_EMPTY_SUMMARY)

    ordered = sorted(
        transitions,
        key=lambda t: (t.session_date or "", t.recorded_at or ""),
    )
    sessions = [_parse_session_date(t.session_date) for t in ordered]
    valid_sessions = [d for d in sessions if d is not None]
    days_tracked = 0
    if valid_sessions:
        days_tracked = (valid_sessions[-1] - valid_sessions[0]).days + 1

    state_dist: Counter[str] = Counter()
    for t in ordered:
        state_dist[t.to_state] += 1

    trans_counts: Counter[str] = Counter()
    for t in ordered:
        trans_counts[t.transition_type] += 1

    # One alignment point per session_date (last transition that day wins).
    by_session: dict[str, WatchlistMaturationTransition] = {}
    for t in ordered:
        key = t.session_date or t.recorded_at[:10]
        by_session[key] = t
    alignment_trend = [
        {
            "session_date": k,
            "layers_aligned": v.layers_aligned,
            "layers_total": v.layers_total,
            "to_state": v.to_state,
        }
        for k, v in sorted(by_session.items())
    ][-max_alignment_points:]

    latest = ordered[-1]
    return {
        "days_tracked": days_tracked,
        "first_session": ordered[0].session_date or None,
        "last_session": latest.session_date or None,
        "state_distribution": dict(state_dist),
        "alignment_trend": alignment_trend,
        "transition_counts": {
            "initial": trans_counts.get("initial", 0),
            "improved": trans_counts.get("improved", 0),
            "worsened": trans_counts.get("worsened", 0),
            "unchanged": trans_counts.get("unchanged", 0),
        },
        "latest_state": latest.to_state,
        "latest_layers_aligned": latest.layers_aligned,
    }


def filter_transitions_by_plan(
    transitions: Sequence[WatchlistMaturationTransition],
    *,
    has_full_access: bool,
    free_row_cap: int = 14,
) -> list[WatchlistMaturationTransition]:
    """Paid: ~90d window; free: last N rows."""
    ordered = sorted(
        transitions,
        key=lambda t: (t.session_date or "", t.recorded_at or ""),
        reverse=True,
    )
    if not has_full_access:
        return list(reversed(ordered[:free_row_cap]))
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=90)
    kept = [
        t
        for t in ordered
        if (_parse_session_date(t.session_date) or date.min) >= cutoff
    ]
    return list(reversed(kept))
