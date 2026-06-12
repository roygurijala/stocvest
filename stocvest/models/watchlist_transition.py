"""Watchlist maturation transition events — append-only setup evolution log."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from stocvest.models.watchlist import WatchlistEntry, WatchlistState

WatchlistTransitionType = Literal["initial", "improved", "worsened", "unchanged"]
EvaluationSource = Literal["evidence", "maturation_refresh", "ledger_capture"]

MATURATION_STATE_RANK: dict[WatchlistState, int] = {
    WatchlistState.INVALIDATED: 1,
    WatchlistState.NOT_ALIGNED: 2,
    WatchlistState.RE_EVALUATING: 3,
    WatchlistState.DEVELOPING: 4,
    WatchlistState.ACTIONABLE: 5,
}

TRANSITION_TTL_DAYS = 90


@dataclass(frozen=True)
class WatchlistMaturationTransition:
    user_id: str
    symbol: str
    mode: Literal["swing", "day"]
    recorded_at: str
    session_date: str
    from_state: str | None
    to_state: str
    layers_aligned: int
    previous_layers_aligned: int | None
    layers_total: int
    alignment_pct: float
    bias: Literal["long", "short", "neutral"]
    transition_type: WatchlistTransitionType
    missing_layers: list[str] = field(default_factory=list)
    evaluation_source: EvaluationSource = "evidence"
    parameter_version: str | None = None
    fundamental_backdrop: str | None = None
    earnings_days_away: int | None = None
    price_at_event: float | None = None
    signal_score: int | None = None

    def to_api_dict(self) -> dict:
        out: dict = {
            "recorded_at": self.recorded_at,
            "session_date": self.session_date,
            "from_state": self.from_state,
            "to_state": self.to_state,
            "layers_aligned": self.layers_aligned,
            "previous_layers_aligned": self.previous_layers_aligned,
            "layers_total": self.layers_total,
            "alignment_pct": self.alignment_pct,
            "bias": self.bias,
            "transition_type": self.transition_type,
            "missing_layers": list(self.missing_layers),
            "evaluation_source": self.evaluation_source,
        }
        if self.parameter_version:
            out["parameter_version"] = self.parameter_version
        if self.fundamental_backdrop:
            out["fundamental_backdrop"] = self.fundamental_backdrop
        if self.earnings_days_away is not None:
            out["earnings_days_away"] = self.earnings_days_away
        if self.signal_score is not None:
            out["signal_score"] = int(self.signal_score)
        return out


def should_log_maturation_transition(
    prev: WatchlistEntry | None,
    next_entry: WatchlistEntry,
) -> bool:
    """Log when state changes or alignment meaningfully changes (not every evaluation)."""
    if prev is None:
        return True
    if prev.state != next_entry.state:
        return True
    if prev.layers_aligned != next_entry.layers_aligned:
        return True
    if set(prev.missing_layers) != set(next_entry.missing_layers):
        return True
    if prev.bias != next_entry.bias:
        return True
    return False


def derive_transition_type(
    prev: WatchlistEntry | None,
    next_entry: WatchlistEntry,
) -> WatchlistTransitionType:
    if prev is None:
        return "initial"
    if prev.state != next_entry.state:
        prev_rank = MATURATION_STATE_RANK.get(prev.state, 0)
        next_rank = MATURATION_STATE_RANK.get(next_entry.state, 0)
        if next_rank > prev_rank:
            return "improved"
        if next_rank < prev_rank:
            return "worsened"
    return "unchanged"
