"""Setup outcome events derived from maturation transition pairs (v1)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal, Sequence

from stocvest.models.watchlist_transition import WatchlistMaturationTransition

OutcomeKind = Literal[
    "alignment_held",
    "alignment_weakened",
    "state_improved",
    "state_worsened",
    "setup_continuation",
    "insufficient_data",
]


@dataclass(frozen=True)
class SetupOutcomeEvent:
    symbol: str
    mode: Literal["swing", "day"]
    session_date: str
    event_state: str
    layers_aligned: int
    layers_total: int
    bias: str
    outcome_kind: OutcomeKind
    next_session_date: str | None
    next_layers_aligned: int | None
    next_state: str | None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "mode": self.mode,
            "session_date": self.session_date,
            "event_state": self.event_state,
            "layers_aligned": self.layers_aligned,
            "layers_total": self.layers_total,
            "bias": self.bias,
            "outcome_kind": self.outcome_kind,
            "next_session_date": self.next_session_date,
            "next_layers_aligned": self.next_layers_aligned,
            "next_state": self.next_state,
        }


def _session_key(t: WatchlistMaturationTransition) -> str:
    return t.session_date or (t.recorded_at[:10] if t.recorded_at else "")


def build_outcome_events(
    symbol: str,
    mode: Literal["swing", "day"],
    transitions: Sequence[WatchlistMaturationTransition],
) -> list[SetupOutcomeEvent]:
    """Pair consecutive session snapshots into observational outcome events."""
    if not transitions:
        return []

    by_session: dict[str, WatchlistMaturationTransition] = {}
    for t in sorted(transitions, key=lambda x: (_session_key(x), x.recorded_at)):
        key = _session_key(t)
        if key:
            by_session[key] = t

    sessions = sorted(by_session.keys())
    events: list[SetupOutcomeEvent] = []
    for i, sess in enumerate(sessions[:-1]):
        cur = by_session[sess]
        nxt = by_session[sessions[i + 1]]
        kind = _classify_pair(cur, nxt)
        events.append(
            SetupOutcomeEvent(
                symbol=symbol.upper(),
                mode=mode,
                session_date=sess,
                event_state=cur.to_state,
                layers_aligned=cur.layers_aligned,
                layers_total=cur.layers_total,
                bias=cur.bias,
                outcome_kind=kind,
                next_session_date=sessions[i + 1],
                next_layers_aligned=nxt.layers_aligned,
                next_state=nxt.to_state,
            )
        )
    return events


def _price_moved_with_bias(
    cur: WatchlistMaturationTransition,
    nxt: WatchlistMaturationTransition,
    *,
    threshold_pct: float = 0.5,
) -> bool:
    p0 = cur.price_at_event
    p1 = nxt.price_at_event
    if p0 is None or p1 is None or p0 <= 0:
        return False
    pct = (p1 - p0) / p0 * 100.0
    if cur.bias == "long":
        return pct >= threshold_pct
    if cur.bias == "short":
        return pct <= -threshold_pct
    return abs(pct) < threshold_pct


def _classify_pair(
    cur: WatchlistMaturationTransition,
    nxt: WatchlistMaturationTransition,
) -> OutcomeKind:
    if cur.transition_type == "improved" or nxt.transition_type == "improved":
        if cur.to_state != nxt.to_state and nxt.transition_type == "improved":
            return "state_improved"
    if cur.transition_type == "worsened" or nxt.transition_type == "worsened":
        if cur.to_state != nxt.to_state and nxt.transition_type == "worsened":
            return "state_worsened"
    if nxt.layers_aligned >= cur.layers_aligned:
        if _price_moved_with_bias(cur, nxt):
            return "setup_continuation"
        return "alignment_held"
    return "alignment_weakened"


def aggregate_outcome_stats(events: Sequence[SetupOutcomeEvent]) -> dict[str, Any]:
    total = len(events)
    if total == 0:
        return {
            "total_events": 0,
            "building_dataset": True,
            "by_kind": {},
            "alignment_held_rate": None,
            "setup_continuation_rate": None,
            "symbols_with_events": 0,
        }

    by_kind: dict[str, int] = {}
    held = 0
    continuation = 0
    symbols: set[str] = set()
    for e in events:
        by_kind[e.outcome_kind] = by_kind.get(e.outcome_kind, 0) + 1
        symbols.add(e.symbol)
        if e.outcome_kind == "alignment_held":
            held += 1
        if e.outcome_kind == "setup_continuation":
            continuation += 1
            held += 1

    rate = round(100.0 * held / total, 1) if total else None
    cont_rate = round(100.0 * continuation / total, 1) if total and continuation else None
    return {
        "total_events": total,
        "building_dataset": total < 5,
        "by_kind": by_kind,
        "alignment_held_rate": rate,
        "setup_continuation_rate": cont_rate,
        "symbols_with_events": len(symbols),
    }


def filter_events_by_days(events: Sequence[SetupOutcomeEvent], days: int) -> list[SetupOutcomeEvent]:
    if days <= 0:
        return list(events)
    try:
        cutoff = date.today().fromordinal(date.today().toordinal() - days)
    except Exception:
        return list(events)

    out: list[SetupOutcomeEvent] = []
    for e in events:
        try:
            d = date.fromisoformat(e.session_date[:10])
        except ValueError:
            continue
        if d >= cutoff:
            out.append(e)
    return out
