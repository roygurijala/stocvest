"""Platform-level per-(symbol, mode) signal state for system evolution logging."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from stocvest.models.watchlist import ProgressBand, WatchlistMode, WatchlistState

SystemEvaluationSource = Literal["desk_batch", "on_demand", "evidence"]


@dataclass
class SystemSignalStateEntry:
    symbol: str
    mode: WatchlistMode
    state: WatchlistState
    previous_state: WatchlistState | None
    state_changed_at: str
    state_change_reason: str

    layers_aligned: int
    layers_total: int = 6
    alignment_pct: float = 0.0
    bias: Literal["long", "short", "neutral"] = "neutral"

    missing_layers: list[str] = field(default_factory=list)
    top_missing_reason: str = ""

    first_evaluated_at: str = ""
    last_evaluated_at: str = ""
    progress_band: ProgressBand = "not_aligned"
