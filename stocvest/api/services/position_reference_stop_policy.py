"""Position-desk reference stop policy — wider weekly ATR floors (ADR-004 POS-D5).

Python twin of ``frontend/lib/scenario/position-reference-stop-resolve.ts``.
Position holds use weekly ATR and wider min-distance rails than swing/day.
"""

from __future__ import annotations

from stocvest.api.services.reference_stop_policy import (
    Direction,
    format_merged_stop_provenance,
    resolve_merged_reference_stop,
    resolve_structural_stop_anchor,
)

# Wider than swing (2.0 / 1.5 / 6%) — multi-month noise tolerance.
POSITION_STOP_ATR_K = 3.0
POSITION_MIN_STOP_ATR_MULT = 2.0
POSITION_MIN_STOP_PCT = 0.10
MIN_POSITION_STOP_DISTANCE_ATR = 2.0
MIN_POSITION_RR = 1.5
POSITION_T2_ATR_BETA = 5.0


def position_reference_stop_atr_k() -> float:
    return POSITION_STOP_ATR_K


def resolve_position_merged_reference_stop(
    *,
    direction: Direction,
    entry: float,
    structural_stop: float | None,
    atr: float | None,
    atr_k: float | None = None,
) -> tuple[float | None, bool]:
    """Merge structural + weekly ATR floor with position min-width policy."""
    return resolve_merged_reference_stop(
        direction=direction,
        entry=entry,
        structural_stop=structural_stop,
        atr=atr,
        atr_k=float(atr_k if atr_k is not None else POSITION_STOP_ATR_K),
        trading_mode="position",
    )


__all__ = [
    "MIN_POSITION_RR",
    "MIN_POSITION_STOP_DISTANCE_ATR",
    "POSITION_MIN_STOP_ATR_MULT",
    "POSITION_MIN_STOP_PCT",
    "POSITION_STOP_ATR_K",
    "POSITION_T2_ATR_BETA",
    "format_merged_stop_provenance",
    "position_reference_stop_atr_k",
    "resolve_position_merged_reference_stop",
    "resolve_structural_stop_anchor",
]
