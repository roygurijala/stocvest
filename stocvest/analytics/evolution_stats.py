"""Aggregate stats from watchlist maturation transition timelines."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Sequence

from stocvest.models.watchlist import MATURATION_LAYER_KEYS
from stocvest.models.watchlist_transition import WatchlistMaturationTransition

ACTIONABLE_SCORE_THRESHOLD = 72
_LAYER_HINTS: dict[str, dict[str, str]] = {
    "technical": {
        "consistent": "Locked in — price structure steady",
        "intermittent": "Flips with indicator noise — watch for confirmation",
        "not_confirming": "Structure not supporting the desk bias",
    },
    "news": {
        "consistent": "Catalyst stream steady",
        "intermittent": "Rare confirms — limited catalyst coverage",
        "not_confirming": "No headline support detected",
    },
    "macro": {
        "consistent": "Macro regime aligned",
        "intermittent": "Macro backdrop shifting session to session",
        "not_confirming": "Neutral every session",
    },
    "sector": {
        "consistent": "Sector relative strength steady",
        "intermittent": "Sector leadership inconsistent",
        "not_confirming": "Sector not participating",
    },
    "geopolitical": {
        "consistent": "Thematic geo exposure present",
        "intermittent": "Geo theme appears sporadically",
        "not_confirming": "No thematic exposure detected",
    },
    "internals": {
        "consistent": "Breadth participation steady",
        "intermittent": "Inconsistent — depends on market breadth",
        "not_confirming": "Breadth not confirming",
    },
}

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


def _ordered_chronological(
    transitions: Sequence[WatchlistMaturationTransition],
) -> list[WatchlistMaturationTransition]:
    return sorted(transitions, key=lambda t: (t.session_date or "", t.recorded_at or ""))


def _sessions_by_date(
    ordered: Sequence[WatchlistMaturationTransition],
) -> list[tuple[str, WatchlistMaturationTransition]]:
    by_session: dict[str, WatchlistMaturationTransition] = {}
    for t in ordered:
        key = t.session_date or (t.recorded_at[:10] if t.recorded_at else "")
        if key:
            by_session[key] = t
    return sorted(by_session.items())


def resolve_signal_score(transition: WatchlistMaturationTransition) -> int:
    """0–100 desk score; uses stored composite score or a legacy layer/state proxy."""
    if transition.signal_score is not None:
        return int(transition.signal_score)
    state_bonus = {
        "actionable": 18,
        "developing": 8,
        "not_aligned": 0,
        "invalidated": 5,
        "re_evaluating": 6,
    }
    bonus = state_bonus.get(str(transition.to_state or "").strip().lower(), 0)
    base = 28 + int(transition.layers_aligned) * 9 + bonus
    return max(0, min(100, base))


def _days_between(start: str | None, end: str | None) -> int | None:
    d0 = _parse_session_date(start or "")
    d1 = _parse_session_date(end or "")
    if d0 is None or d1 is None:
        return None
    return max(0, (d1 - d0).days)


def _format_short_date(ymd: str) -> str:
    d = _parse_session_date(ymd)
    if d is None:
        return ymd
    return f"{d.strftime('%b')} {d.day}"


def compute_score_trend(
    transitions: Sequence[WatchlistMaturationTransition],
    *,
    max_points: int = 30,
) -> list[dict[str, Any]]:
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    points = [
        {
            "session_date": k,
            "signal_score": resolve_signal_score(v),
            "to_state": v.to_state,
            "layers_aligned": v.layers_aligned,
            "layers_total": v.layers_total,
        }
        for k, v in sessions
    ]
    return points[-max_points:]


def compute_state_journey(transitions: Sequence[WatchlistMaturationTransition]) -> list[dict[str, Any]]:
    """Horizontal state flow segments with dwell time and score at entry."""
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    if not sessions:
        return []

    segments: list[dict[str, Any]] = []
    seg_start_idx = 0
    for i in range(1, len(sessions)):
        prev_state = sessions[i - 1][1].to_state
        curr_state = sessions[i][1].to_state
        if curr_state == prev_state:
            continue
        start_key, start_t = sessions[seg_start_idx]
        end_key, _ = sessions[i - 1]
        segments.append(
            {
                "state": prev_state,
                "started_session": start_key,
                "ended_session": end_key,
                "duration_days": _days_between(start_key, end_key),
                "entry_score": resolve_signal_score(start_t),
                "entry_layers_aligned": start_t.layers_aligned,
            }
        )
        seg_start_idx = i

    start_key, start_t = sessions[seg_start_idx]
    last_key, last_t = sessions[-1]
    segments.append(
        {
            "state": sessions[seg_start_idx][1].to_state,
            "started_session": start_key,
            "ended_session": None,
            "duration_days": _days_between(start_key, last_key),
            "entry_score": resolve_signal_score(start_t),
            "entry_layers_aligned": start_t.layers_aligned,
            "current_score": resolve_signal_score(last_t),
            "is_current": True,
        }
    )
    return segments


def compute_inflection_moments(
    transitions: Sequence[WatchlistMaturationTransition],
) -> dict[str, Any]:
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    if not sessions:
        return {
            "peak": None,
            "biggest_jump": None,
            "current_state_streak_days": None,
            "momentum": None,
        }

    scored = [(k, resolve_signal_score(v), v.to_state) for k, v in sessions]
    peak_key, peak_score, peak_state = max(scored, key=lambda x: x[1])
    peak = {
        "session_date": peak_key,
        "signal_score": peak_score,
        "to_state": peak_state,
        "label": f"Peak alignment: {_format_short_date(peak_key)}, score {peak_score}",
    }

    biggest_delta = 0
    jump_from = scored[0]
    jump_to = scored[0]
    for i in range(1, len(scored)):
        delta = scored[i][1] - scored[i - 1][1]
        if delta > biggest_delta:
            biggest_delta = delta
            jump_from = scored[i - 1]
            jump_to = scored[i]
    biggest_jump = None
    if biggest_delta > 0:
        biggest_jump = {
            "from_session": jump_from[0],
            "to_session": jump_to[0],
            "delta": biggest_delta,
            "label": f"Biggest jump: +{biggest_delta} points on {_format_short_date(jump_to[0])}",
        }

    latest_state = scored[-1][2]
    streak_start = scored[-1][0]
    for i in range(len(scored) - 2, -1, -1):
        if scored[i][2] != latest_state:
            break
        streak_start = scored[i][0]
    streak_days = _days_between(streak_start, scored[-1][0])
    if streak_days is not None:
        streak_days = max(1, streak_days + 1)

    momentum = None
    if len(scored) >= 2:
        window = scored[-3:] if len(scored) >= 3 else scored
        delta_sum = window[-1][1] - window[0][1]
        if delta_sum >= 3:
            direction = "strengthening"
            symbol = "↑"
        elif delta_sum <= -3:
            direction = "weakening"
            symbol = "↓"
        else:
            direction = "stable"
            symbol = "→"
        momentum = {
            "direction": direction,
            "delta_last_sessions": delta_sum,
            "sessions_window": len(window),
            "label": f"Momentum: {symbol} {direction.capitalize()} ({delta_sum:+d} pts last {len(window)} sessions)",
        }

    return {
        "peak": peak,
        "biggest_jump": biggest_jump,
        "current_state_streak_days": streak_days,
        "current_state": latest_state,
        "momentum": momentum,
    }


def compute_layer_stability(
    transitions: Sequence[WatchlistMaturationTransition],
) -> list[dict[str, Any]]:
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    if not sessions:
        return []

    total = len(sessions)
    confirm_counts: Counter[str] = Counter()
    for _, t in sessions:
        missing = {str(x).strip().lower() for x in t.missing_layers}
        for layer in MATURATION_LAYER_KEYS:
            if layer not in missing:
                confirm_counts[layer] += 1

    blocks: list[dict[str, Any]] = []
    for layer in MATURATION_LAYER_KEYS:
        confirmed = confirm_counts.get(layer, 0)
        rate = confirmed / total if total else 0.0
        if rate >= 0.85:
            band = "consistent"
        elif rate <= 0.15:
            band = "not_confirming"
        else:
            band = "intermittent"
        blocks.append(
            {
                "layer": layer,
                "confirm_rate": round(rate, 3),
                "confirmed_sessions": confirmed,
                "total_sessions": total,
                "band": band,
                "pattern": _layer_pattern(sessions, layer),
                "hint": _LAYER_HINTS.get(layer, {}).get(band, ""),
            }
        )
    return blocks


def _layer_pattern(
    sessions: list[tuple[str, WatchlistMaturationTransition]],
    layer: str,
) -> str:
    """Compact block string for the last N sessions (■ = confirmed, ▨ = missing)."""
    tail = sessions[-7:]
    chars = []
    for _, t in tail:
        missing = {str(x).strip().lower() for x in t.missing_layers}
        chars.append("■" if layer not in missing else "▨")
    return "".join(chars)


def compute_score_timeline(
    transitions: Sequence[WatchlistMaturationTransition],
    *,
    max_rows: int = 21,
) -> list[dict[str, Any]]:
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    if not sessions:
        return []

    rows: list[dict[str, Any]] = []
    prev_score: int | None = None
    prev_state: str | None = None
    for session_date, t in sessions:
        score = resolve_signal_score(t)
        delta = score - prev_score if prev_score is not None else 0
        state_changed = prev_state is not None and t.to_state != prev_state
        if prev_score is None:
            dot = "○"
            delta_label = "—"
        elif state_changed:
            dot = "▲"
            delta_label = f"{delta:+d}pts"
        elif delta > 0:
            dot = "●"
            delta_label = f"+{delta}pts"
        elif delta < 0:
            dot = "●"
            delta_label = f"{delta}pts"
        else:
            dot = "●"
            delta_label = "±0pts"

        summary = _timeline_summary(t, prev_score, score, state_changed)
        rows.append(
            {
                "session_date": session_date,
                "signal_score": score,
                "score_delta": delta if prev_score is not None else None,
                "delta_label": delta_label,
                "to_state": t.to_state,
                "layers_aligned": t.layers_aligned,
                "state_changed": state_changed,
                "dot": dot,
                "summary": summary,
            }
        )
        prev_score = score
        prev_state = t.to_state

    return list(reversed(rows[-max_rows:]))


def _timeline_summary(
    t: WatchlistMaturationTransition,
    prev_score: int | None,
    score: int,
    state_changed: bool,
) -> str:
    if prev_score is None:
        return "Tracking started"
    if state_changed:
        return f"State moved to {t.to_state.replace('_', ' ')}"
    if t.transition_type == "improved":
        missing = ", ".join(t.missing_layers[:2]) if t.missing_layers else "fewer gaps"
        return f"Layers improved — still watching {missing}" if t.missing_layers else "Layers improved"
    if score > prev_score:
        return "Score improved — desk read strengthening"
    if score < prev_score:
        return "Score eased — desk read softening"
    return "No material change in layers"


def compute_forward_projection(
    transitions: Sequence[WatchlistMaturationTransition],
    *,
    threshold: int = ACTIONABLE_SCORE_THRESHOLD,
) -> dict[str, Any] | None:
    sessions = _sessions_by_date(_ordered_chronological(transitions))
    if len(sessions) < 2:
        return None

    scored = [resolve_signal_score(v) for _, v in sessions]
    latest_score = scored[-1]
    window = scored[-3:] if len(scored) >= 3 else scored
    if len(window) < 2:
        return None

    slope = (window[-1] - window[0]) / (len(window) - 1)
    if abs(slope) < 0.25:
        return {
            "kind": "stable",
            "label": "At current pace the score is holding steady — check back after the next evaluation.",
            "disclaimer": "Linear extrapolation from recent sessions — not a forecast.",
        }

    if latest_score >= threshold and slope < 0:
        sessions_to_floor = int(max(1, round((latest_score - (threshold - 5)) / abs(slope))))
        return {
            "kind": "cooling_risk",
            "sessions_estimate": sessions_to_floor,
            "label": (
                f"At current velocity ({slope:+.1f} pts/session), score could slip below "
                f"the {threshold} desk band in ~{sessions_to_floor} session(s)."
            ),
            "disclaimer": "Linear extrapolation from recent sessions — not a forecast.",
        }

    if latest_score < threshold and slope > 0:
        gap = threshold - latest_score
        sessions_needed = int(max(1, round(gap / slope)))
        return {
            "kind": "toward_actionable",
            "sessions_estimate": sessions_needed,
            "label": (
                f"At current velocity (+{slope:.1f} pts/session), the setup could reach "
                f"the {threshold} desk band in ~{sessions_needed} session(s)."
            ),
            "disclaimer": "Linear extrapolation from recent sessions — not a forecast.",
        }

    if latest_score >= threshold and slope >= 0:
        return {
            "kind": "holding_actionable",
            "label": "Score is holding in the actionable band at current velocity.",
            "disclaimer": "Linear extrapolation from recent sessions — not a forecast.",
        }

    return {
        "kind": "softening",
        "label": "Score trend is negative — momentum bears watching before leaning in.",
        "disclaimer": "Linear extrapolation from recent sessions — not a forecast.",
    }


def compute_evolution_analytics(
    transitions: Sequence[WatchlistMaturationTransition],
) -> dict[str, Any]:
    """Rich evolution tab payload — score trend, journey, stability, timeline, projection."""
    ordered = _ordered_chronological(transitions)
    if not ordered:
        return {
            "actionable_score_threshold": ACTIONABLE_SCORE_THRESHOLD,
            "score_trend": [],
            "state_journey": [],
            "inflection": compute_inflection_moments([]),
            "layer_stability": [],
            "score_timeline": [],
            "forward_projection": None,
        }
    return {
        "actionable_score_threshold": ACTIONABLE_SCORE_THRESHOLD,
        "score_trend": compute_score_trend(ordered),
        "state_journey": compute_state_journey(ordered),
        "inflection": compute_inflection_moments(ordered),
        "layer_stability": compute_layer_stability(ordered),
        "score_timeline": compute_score_timeline(ordered),
        "forward_projection": compute_forward_projection(ordered),
    }
