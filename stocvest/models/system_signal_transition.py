"""Platform-level setup evolution transitions (no user association)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from stocvest.models.system_signal_state import SystemEvaluationSource, SystemSignalStateEntry
from stocvest.models.watchlist import WatchlistEntry
from stocvest.models.watchlist_transition import (
    MATURATION_STATE_RANK,
    TRANSITION_TTL_DAYS,
    WatchlistMaturationTransition,
    WatchlistTransitionType,
)

SystemTransitionType = WatchlistTransitionType


@dataclass(frozen=True)
class SystemSignalTransition:
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
    transition_type: SystemTransitionType
    missing_layers: list[str] = field(default_factory=list)
    evaluation_source: SystemEvaluationSource = "desk_batch"
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

    def to_watchlist_transition(self) -> WatchlistMaturationTransition:
        """Adapter for shared evolution analytics."""
        eval_src = "evidence" if self.evaluation_source == "evidence" else "maturation_refresh"
        return WatchlistMaturationTransition(
            user_id="__system__",
            symbol=self.symbol,
            mode=self.mode,
            recorded_at=self.recorded_at,
            session_date=self.session_date,
            from_state=self.from_state,
            to_state=self.to_state,
            layers_aligned=self.layers_aligned,
            previous_layers_aligned=self.previous_layers_aligned,
            layers_total=self.layers_total,
            alignment_pct=self.alignment_pct,
            bias=self.bias,
            transition_type=self.transition_type,
            missing_layers=list(self.missing_layers),
            evaluation_source=eval_src,
            parameter_version=self.parameter_version,
            fundamental_backdrop=self.fundamental_backdrop,
            earnings_days_away=self.earnings_days_away,
            price_at_event=self.price_at_event,
            signal_score=self.signal_score,
        )


def should_log_system_transition(
    prev: SystemSignalStateEntry | None,
    next_entry: SystemSignalStateEntry,
) -> bool:
    from stocvest.models.system_signal_state import SystemSignalStateEntry as _Entry

    _ = _Entry
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


def derive_system_transition_type(
    prev: SystemSignalStateEntry | None,
    next_entry: SystemSignalStateEntry,
) -> SystemTransitionType:
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


def system_state_as_watchlist_entry(entry: SystemSignalStateEntry) -> WatchlistEntry:
    """Adapter for shared transition-type helpers."""
    return WatchlistEntry(
        user_id="__system__",
        symbol=entry.symbol,
        mode=entry.mode,
        state=entry.state,
        previous_state=entry.previous_state,
        state_changed_at=entry.state_changed_at,
        state_change_reason=entry.state_change_reason,
        layers_aligned=entry.layers_aligned,
        layers_total=entry.layers_total,
        alignment_pct=entry.alignment_pct,
        bias=entry.bias,
        missing_layers=list(entry.missing_layers),
        top_missing_reason=entry.top_missing_reason,
        added_at=entry.first_evaluated_at,
        added_from="system",
        last_evaluated_at=entry.last_evaluated_at,
        progress_band=entry.progress_band,
    )
