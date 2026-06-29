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

All distances are normalized by ATR so the model behaves the same across $5 and $500 names.
Keep provenance literals in sync with ``target_provenance.py`` and ``frontend/lib/target-provenance.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

_TINY = 1e-6

# Per-desk ATR multiples.
#   t1_alpha / t1_beta — the [min, max] ATR band a structural R1 must fall inside to anchor T1.
#   t2_beta            — ATR extension distance for the volatility T2 candidate.
_PARAMS: dict[str, dict[str, float]] = {
    "day": {"t1_alpha": 0.8, "t1_beta": 2.0, "t2_beta": 2.5},
    "swing": {"t1_alpha": 1.5, "t1_beta": 3.0, "t2_beta": 4.0},
}

# Cap on clustered candidate levels kept for selection (nearest-first) — prevents level
# explosion / noisy clustering. "Top N nearest within the candidate window."
_MAX_CANDIDATES = 5
# Minimum window (ATR multiples) for collecting candidate levels around entry. Widened to
# ``t1_beta`` so the T1 upper bound is actually reachable from real structure.
_BASE_WINDOW_ATR = 2.0


def geometry_params(trading_mode: str) -> dict[str, float]:
    return _PARAMS["day"] if str(trading_mode).strip().lower() == "day" else _PARAMS["swing"]


def adaptive_epsilon(atr: float, price: float) -> float:
    """Clustering tolerance: ``max(0.3*ATR, price*0.2%)`` — adapts to low- and high-ATR names."""
    return max(0.3 * float(atr), abs(float(price)) * 0.002)


@dataclass(frozen=True)
class LevelZone:
    """A clustered price zone; ``level`` is the entry-facing edge (nearest to entry)."""

    level: float
    touch_count: int
    recency: float  # 0..1, newer touches weighted higher
    strength: float  # touch_count + recency (tiebreak only)


@dataclass(frozen=True)
class TargetGeometry:
    target_1: float | None
    target_2: float | None
    target_1_source: Literal["structural", "atr_floor"] | None
    target_2_provenance: Literal["resistance", "atr_extension", "2r_extension"] | None
    candidates: tuple[float, ...]  # clustered candidate levels used (nearest-first), for debugging


def _bar_extremes(daily_bars: list[dict[str, float]] | None, key: str) -> list[tuple[float, float]]:
    """Return ``(level, recency)`` for every bar ``key`` (recency 0..1, newest = 1).

    Bars are oldest->newest (see ``serialize_daily_bars_for_range``). Every bar high/low is a
    candidate touch; clustering collapses repeats and rewards real, repeatedly-tested levels.
    """
    if not daily_bars:
        return []
    out: list[tuple[float, float]] = []
    n = len(daily_bars)
    denom = float(n - 1) if n > 1 else 1.0
    for i, bar in enumerate(daily_bars):
        try:
            v = float(bar.get(key))  # type: ignore[union-attr]
        except (TypeError, ValueError, AttributeError):
            continue
        if v > 0:
            out.append((v, (i / denom) if n > 1 else 1.0))
    return out


def _cluster(points: list[tuple[float, float]], *, epsilon: float, edge: Literal["low", "high"]) -> list[LevelZone]:
    """Group ``(level, recency)`` points within ``epsilon`` into zones.

    ``edge="low"`` keeps the lowest member as the representative (nearest above entry for
    resistance); ``edge="high"`` keeps the highest (nearest below entry for support).
    """
    if not points:
        return []
    pts = sorted(points, key=lambda p: p[0])
    clusters: list[list[tuple[float, float]]] = [[pts[0]]]
    for level, recency in pts[1:]:
        if level - clusters[-1][-1][0] <= epsilon + _TINY:
            clusters[-1].append((level, recency))
        else:
            clusters.append([(level, recency)])
    zones: list[LevelZone] = []
    for members in clusters:
        levels = [m[0] for m in members]
        rep = min(levels) if edge == "low" else max(levels)
        touch = len(members)
        recency = max(m[1] for m in members)
        zones.append(
            LevelZone(level=round(rep, 4), touch_count=touch, recency=recency, strength=touch + recency)
        )
    return zones


def _resistance_candidates(
    *,
    entry: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    extra_levels: list[float | None],
    window_atr: float,
) -> list[LevelZone]:
    """Clustered resistance zones strictly above ``entry`` within ``window_atr*ATR``, nearest-first, capped."""
    points = _bar_extremes(daily_bars, "high")
    for raw in extra_levels:
        if raw is None:
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            continue
        if v > 0:
            points.append((v, 1.0))  # SMAs / session high are "current" -> max recency
    epsilon = adaptive_epsilon(atr, entry)
    zones = _cluster(points, epsilon=epsilon, edge="low")
    hi_cap = entry + window_atr * atr
    above = [z for z in zones if z.level > entry + _TINY and z.level <= hi_cap + _TINY]
    above.sort(key=lambda z: (z.level - entry))  # nearest first
    return above[:_MAX_CANDIDATES]


def _support_candidates(
    *,
    entry: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    extra_levels: list[float | None],
    window_atr: float,
) -> list[LevelZone]:
    """Clustered support zones strictly below ``entry`` within ``window_atr*ATR``, nearest-first, capped."""
    points = _bar_extremes(daily_bars, "low")
    for raw in extra_levels:
        if raw is None:
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            continue
        if v > 0:
            points.append((v, 1.0))
    epsilon = adaptive_epsilon(atr, entry)
    zones = _cluster(points, epsilon=epsilon, edge="high")
    lo_cap = entry - window_atr * atr
    below = [z for z in zones if z.level < entry - _TINY and z.level >= lo_cap - _TINY]
    below.sort(key=lambda z: (entry - z.level))  # nearest first
    return below[:_MAX_CANDIDATES]


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
    window = max(_BASE_WINDOW_ATR, beta)
    zones = _resistance_candidates(
        entry=entry,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=[day_hi, sma20, sma50, sma200],
        window_atr=window,
    )

    # --- T1: nearest structural zone within [alpha*ATR, beta*ATR]; else entry + alpha*ATR ---
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

    # --- T2: min of {next structural resistance above T1, entry + t2_beta*ATR, entry + 2R} ---
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
        # min level; "resistance" listed first so ties resolve to the structural label.
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
    window = max(_BASE_WINDOW_ATR, beta)
    zones = _support_candidates(
        entry=entry,
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
        # max level = nearest below entry; "resistance" first so ties resolve structural.
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
