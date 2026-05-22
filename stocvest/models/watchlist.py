"""
Watchlist maturation — per-(user, symbol, mode) engine state.

Layer keys align with composite / signal-evidence vocabulary used across STOCVEST.
See docs/WATCHLIST_MATURATION_ARCH.md for storage and access patterns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Literal

WatchlistMode = Literal["swing", "day"]


class WatchlistState(str, Enum):
    NOT_ALIGNED = "not_aligned"
    DEVELOPING = "developing"
    ACTIONABLE = "actionable"
    INVALIDATED = "invalidated"
    RE_EVALUATING = "re_evaluating"


STATE_COLORS: dict[WatchlistState, str] = {
    WatchlistState.NOT_ALIGNED: "red",
    WatchlistState.DEVELOPING: "amber",
    WatchlistState.ACTIONABLE: "green",
    WatchlistState.INVALIDATED: "gray",
    WatchlistState.RE_EVALUATING: "blue",
}

STATE_LABELS: dict[WatchlistState, str] = {
    WatchlistState.NOT_ALIGNED: "Not aligned",
    WatchlistState.DEVELOPING: "Developing",
    WatchlistState.ACTIONABLE: "Actionable",
    WatchlistState.INVALIDATED: "Invalidated",
    WatchlistState.RE_EVALUATING: "Re-evaluating",
}

# Layer alignment thresholds (count of layers aligned with composite direction).
DEVELOPING_THRESHOLD = 3  # >= this → Developing or Re-evaluating
NEAR_READY_LAYER_COUNT = 4  # display-only engagement band (B47); does not change derive_state
ACTIONABLE_THRESHOLD = 5  # >= this → Actionable

ProgressBand = Literal["not_aligned", "developing", "near_ready", "actionable"]

# Canonical layer keys (composite / evidence card contract).
_ALL_LAYERS: tuple[str, ...] = (
    "technical",
    "news",
    "macro",
    "sector",
    "geopolitical",
    "internals",
)

MATURATION_LAYER_KEYS: tuple[str, ...] = _ALL_LAYERS
"""Six layer ids used in composite evidence payloads and maturation rows."""


def user_state_gsi_keys(user_id: str, state: WatchlistState, symbol: str, mode: WatchlistMode) -> tuple[str, str]:
    """Projected keys for DynamoDB UserStateIndex (GSI)."""
    gsi1pk = user_state_gsi_partition_key(user_id)
    gsi1sk = f"STATE#{state.value}#SYM#{symbol.upper()}#MODE#{mode}"
    return gsi1pk, gsi1sk


def user_state_gsi_partition_key(user_id: str) -> str:
    """GSI hash key for all maturation rows for a user."""
    return f"USER#{user_id}"


def _parse_iso_utc(raw: str) -> datetime | None:
    s = (raw or "").strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


@dataclass
class WatchlistEntry:
    user_id: str
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

    added_at: str = ""
    added_from: str = "search"
    last_evaluated_at: str = ""
    last_evaluated_session: str = ""

    invalidated_at: str | None = None
    invalidation_reason: str | None = None
    archive_after: str | None = None
    progress_band: ProgressBand = "not_aligned"

    @property
    def readiness_label(self) -> str:
        """Human-readable readiness (paid UI); uses missing_layers as 'not aligned' layers."""
        base = f"{self.layers_aligned}/{self.layers_total} aligned"
        core = {"technical", "news"}
        aligned_set = {layer for layer in _ALL_LAYERS if layer not in set(self.missing_layers)}
        if core.issubset(aligned_set):
            return f"{base} — core ✓"
        if not core.intersection(aligned_set):
            return f"{base} — context only"
        return base

    def should_exclude_from_active_queries(self) -> bool:
        """
        True when an invalidated row should drop out of default “active” lists.

        Invalidated rows without archive_after are excluded immediately.
        """
        if self.state != WatchlistState.INVALIDATED:
            return False
        if not (self.archive_after or "").strip():
            return True
        end = _parse_iso_utc(self.archive_after)
        if end is None:
            return True
        return datetime.now(timezone.utc) >= end

    @property
    def color(self) -> str:
        return STATE_COLORS[self.state]

    @property
    def label(self) -> str:
        return STATE_LABELS[self.state]


def derive_state(
    layers_aligned: int,
    previous_state: WatchlistState | None,
    *,
    was_invalidated: bool = False,
) -> WatchlistState:
    """
    Derive maturation state from aligned layer count and history.

    - >= ACTIONABLE_THRESHOLD (5) → Actionable
    - >= DEVELOPING_THRESHOLD (3) → Developing, or Re-evaluating if recovering from Invalidated
    - Below DEVELOPING_THRESHOLD: if previously viable → Invalidated, else Not aligned
    """
    was_viable = previous_state in (
        WatchlistState.ACTIONABLE,
        WatchlistState.DEVELOPING,
        WatchlistState.RE_EVALUATING,
    )

    if layers_aligned >= ACTIONABLE_THRESHOLD:
        return WatchlistState.ACTIONABLE

    if layers_aligned >= DEVELOPING_THRESHOLD:
        if was_invalidated:
            return WatchlistState.RE_EVALUATING
        return WatchlistState.DEVELOPING

    if was_viable:
        return WatchlistState.INVALIDATED

    return WatchlistState.NOT_ALIGNED


def derive_progress_band(
    layers_aligned: int,
    *,
    state: WatchlistState | None = None,
) -> ProgressBand:
    """
    Display-only progress band for engagement surfaces (B47 near-ready @ 4/6).

    Does not affect ``derive_state`` or actionable gates.
    """
    if state == WatchlistState.INVALIDATED:
        return "not_aligned"
    if layers_aligned >= ACTIONABLE_THRESHOLD:
        return "actionable"
    if layers_aligned == NEAR_READY_LAYER_COUNT:
        return "near_ready"
    if layers_aligned >= DEVELOPING_THRESHOLD:
        return "developing"
    return "not_aligned"
