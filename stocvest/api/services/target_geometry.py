"""Volatility-normalized target geometry (B78) — bounded T1, multi-candidate T2, clustered resistance.

Pure, testable level math layered on top of target-geometry v2. Gated by
``settings.stocvest_target_geometry_v3_enabled``. When disabled (or ATR missing) callers
keep the v2 behavior untouched.

System rule (elite-desk framing):
    STOP = where you're wrong   (unchanged — see reference_stop_policy)
    T1   = where the market first reacts (nearest structural resistance in an ATR band,
           else a volatility floor entry + alpha*ATR)
    T2   = where the trend exhausts (min of: next structural resistance, entry + beta*ATR,
           entry + 2R) — bounded by structure, robust via the R-multiple fallback.

Zone clustering lives in ``structure_engine`` (B80) — shared with entry anchors and T2 scans.
Keep provenance literals in sync with ``target_provenance.py`` and ``frontend/lib/target-provenance.ts``.
"""

from __future__ import annotations

from typing import Literal

from stocvest.api.services.structure_engine import (
    LevelZone,
    adaptive_epsilon,
    candidate_window_atr,
    desk_geometry_params,
    resistance_zones,
    support_zones,
)

_TINY = 1e-6

# Re-export for existing tests / callers.
geometry_params = desk_geometry_params


class TargetGeometry:
    __slots__ = ("target_1", "target_2", "target_1_source", "target_2_provenance", "candidates")

    def __init__(
        self,
        target_1: float | None,
        target_2: float | None,
        target_1_source: Literal["structural", "atr_floor"] | None,
        target_2_provenance: Literal["resistance", "atr_extension", "2r_extension"] | None,
        candidates: tuple[float, ...],
    ) -> None:
        self.target_1 = target_1
        self.target_2 = target_2
        self.target_1_source = target_1_source
        self.target_2_provenance = target_2_provenance
        self.candidates = candidates


def compute_long_geometry(
    *,
    entry: float,
    atr: float,
    stop: float | None,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str,
    day_hi: float | None = None,
    sma20: float | None = None,
    sma50: float | None = None,
    sma200: float | None = None,
) -> TargetGeometry:
    """Bounded T1 + multi-candidate T2 for a long. Returns ``TargetGeometry`` (None levels when unusable)."""
    if entry <= 0 or atr <= 0:
        return TargetGeometry(None, None, None, None, ())
    p = geometry_params(trading_mode)
    alpha, beta, t2_beta = p["t1_alpha"], p["t1_beta"], p["t2_beta"]
    window = candidate_window_atr(trading_mode)
    zones = resistance_zones(
        reference=entry,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=[day_hi, sma20, sma50, sma200],
        window_atr=window,
    )

    t1: float | None = None
    t1_source: Literal["structural", "atr_floor"] | None = None
    lo_band, hi_band = alpha * atr, beta * atr
    for z in zones:
        dist = z.level - entry
        if lo_band - _TINY <= dist <= hi_band + _TINY:
            t1, t1_source = z.level, "structural"
            break
    if t1 is None:
        t1, t1_source = round(entry + alpha * atr, 4), "atr_floor"

    candidates: list[tuple[float, str]] = []
    struct_t2 = next((z.level for z in zones if z.level > t1 + _TINY), None)
    if struct_t2 is not None:
        candidates.append((round(struct_t2, 4), "resistance"))
    atr_ext = round(entry + t2_beta * atr, 4)
    if atr_ext > t1 + _TINY:
        candidates.append((atr_ext, "atr_extension"))
    if stop is not None and stop < entry - _TINY:
        r2 = round(entry + 2.0 * (entry - stop), 4)
        if r2 > t1 + _TINY:
            candidates.append((r2, "2r_extension"))

    t2: float | None = None
    t2_provenance: Literal["resistance", "atr_extension", "2r_extension"] | None = None
    if candidates:
        t2, t2_provenance = min(candidates, key=lambda c: c[0])  # type: ignore[assignment]

    return TargetGeometry(
        target_1=t1,
        target_2=t2,
        target_1_source=t1_source,
        target_2_provenance=t2_provenance,
        candidates=tuple(z.level for z in zones),
    )


def compute_short_geometry(
    *,
    entry: float,
    atr: float,
    stop: float | None,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str,
    day_lo: float | None = None,
    sma20: float | None = None,
    sma50: float | None = None,
    sma200: float | None = None,
) -> TargetGeometry:
    """Mirror of :func:`compute_long_geometry` for a short (support below entry)."""
    if entry <= 0 or atr <= 0:
        return TargetGeometry(None, None, None, None, ())
    p = geometry_params(trading_mode)
    alpha, beta, t2_beta = p["t1_alpha"], p["t1_beta"], p["t2_beta"]
    window = candidate_window_atr(trading_mode)
    zones = support_zones(
        reference=entry,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=[day_lo, sma20, sma50, sma200],
        window_atr=window,
    )

    t1: float | None = None
    t1_source: Literal["structural", "atr_floor"] | None = None
    lo_band, hi_band = alpha * atr, beta * atr
    for z in zones:
        dist = entry - z.level
        if lo_band - _TINY <= dist <= hi_band + _TINY:
            t1, t1_source = z.level, "structural"
            break
    if t1 is None:
        t1, t1_source = round(entry - alpha * atr, 4), "atr_floor"

    candidates: list[tuple[float, str]] = []
    struct_t2 = next((z.level for z in zones if z.level < t1 - _TINY), None)
    if struct_t2 is not None:
        candidates.append((round(struct_t2, 4), "resistance"))
    atr_ext = round(entry - t2_beta * atr, 4)
    if atr_ext < t1 - _TINY and atr_ext > 0:
        candidates.append((atr_ext, "atr_extension"))
    if stop is not None and stop > entry + _TINY:
        r2 = round(entry - 2.0 * (stop - entry), 4)
        if r2 < t1 - _TINY and r2 > 0:
            candidates.append((r2, "2r_extension"))

    t2: float | None = None
    t2_provenance: Literal["resistance", "atr_extension", "2r_extension"] | None = None
    if candidates:
        t2, t2_provenance = max(candidates, key=lambda c: c[0])  # type: ignore[assignment]

    return TargetGeometry(
        target_1=t1,
        target_2=t2,
        target_1_source=t1_source,
        target_2_provenance=t2_provenance,
        candidates=tuple(z.level for z in zones),
    )


def distance_in_atr(level: float | None, entry: float | None, atr: float | None) -> float | None:
    """``|level - entry| / ATR`` rounded to 2dp, or None when inputs are unusable."""
    if level is None or entry is None or atr is None:
        return None
    if atr <= 0:
        return None
    return round(abs(float(level) - float(entry)) / float(atr), 2)
