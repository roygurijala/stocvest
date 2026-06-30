"""Unified structure engine (B80) — clustered support/resistance zones for the desk pipeline.

Single source of truth for zone detection used by target geometry (T1/T2), entry-zone
anchors, legacy T2 scans, and (eventually) assistant chart levels. Replaces ad-hoc
nearest-pivot + fixed 25% proximity with ATR-normalized windows and touch/recency scoring.

Keep ``LevelZone`` fields and clustering math in sync with ``target_geometry.py`` consumers
and ``frontend/lib/structure-resistance-scanner.ts`` where mirrored.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

_TINY = 1e-6

# Per-desk ATR multiples (shared with target_geometry geometry_params).
_DESK_PARAMS: dict[str, dict[str, float]] = {
    "day": {"t1_alpha": 0.8, "t1_beta": 2.0, "t2_beta": 2.5},
    "swing": {"t1_alpha": 1.5, "t1_beta": 3.0, "t2_beta": 4.0},
}
_BASE_WINDOW_ATR = 2.0
_MAX_CANDIDATES = 5


def desk_geometry_params(trading_mode: str) -> dict[str, float]:
    return _DESK_PARAMS["day"] if str(trading_mode).strip().lower() == "day" else _DESK_PARAMS["swing"]


def candidate_window_atr(trading_mode: str) -> float:
    """ATR multiples for collecting structural candidates around ``last`` / ``entry``."""
    return max(_BASE_WINDOW_ATR, desk_geometry_params(trading_mode)["t1_beta"])


def adaptive_epsilon(atr: float, price: float) -> float:
    """Clustering tolerance: ``max(0.3*ATR, price*0.2%)``."""
    return max(0.3 * float(atr), abs(float(price)) * 0.002)


@dataclass(frozen=True)
class LevelZone:
    """A clustered price zone; ``level`` is the entry-facing edge (nearest to reference price)."""

    level: float
    touch_count: int
    recency: float  # 0..1, newer touches weighted higher
    strength: float  # touch_count + recency (tiebreak only)


@dataclass(frozen=True)
class StructureSnapshot:
    """Ranked zones above/below ``last`` within the desk ATR window."""

    last: float
    atr: float
    trading_mode: str
    resistance: tuple[LevelZone, ...]
    support: tuple[LevelZone, ...]


def bar_extremes_with_recency(
    daily_bars: list[dict[str, float]] | None, key: str
) -> list[tuple[float, float]]:
    """``(level, recency)`` for every bar extreme; recency 0..1, newest = 1."""
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


def cluster_level_points(
    points: list[tuple[float, float]], *, epsilon: float, edge: Literal["low", "high"]
) -> list[LevelZone]:
    """Group nearby ``(level, recency)`` touches into zones."""
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


def _positive_levels(raw_levels: list[float | None]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for raw in raw_levels:
        if raw is None:
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            continue
        if v > 0:
            out.append((v, 1.0))
    return out


def resistance_zones(
    *,
    reference: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    extra_levels: list[float | None] | None = None,
    window_atr: float,
) -> list[LevelZone]:
    """Clustered resistance strictly above ``reference`` within ``window_atr * ATR``."""
    points = bar_extremes_with_recency(daily_bars, "high")
    points.extend(_positive_levels(extra_levels or []))
    epsilon = adaptive_epsilon(atr, reference)
    zones = cluster_level_points(points, epsilon=epsilon, edge="low")
    hi_cap = reference + window_atr * atr
    above = [z for z in zones if z.level > reference + _TINY and z.level <= hi_cap + _TINY]
    above.sort(key=lambda z: (z.level - reference))
    return above[:_MAX_CANDIDATES]


def support_zones(
    *,
    reference: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    extra_levels: list[float | None] | None = None,
    window_atr: float,
) -> list[LevelZone]:
    """Clustered support strictly below ``reference`` within ``window_atr * ATR``."""
    points = bar_extremes_with_recency(daily_bars, "low")
    points.extend(_positive_levels(extra_levels or []))
    epsilon = adaptive_epsilon(atr, reference)
    zones = cluster_level_points(points, epsilon=epsilon, edge="high")
    lo_cap = reference - window_atr * atr
    below = [z for z in zones if z.level < reference - _TINY and z.level >= lo_cap - _TINY]
    below.sort(key=lambda z: (reference - z.level))
    return below[:_MAX_CANDIDATES]


def build_structure_snapshot(
    *,
    last: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str,
    resistance_extras: list[float | None] | None = None,
    support_extras: list[float | None] | None = None,
) -> StructureSnapshot | None:
    if last <= 0 or atr <= 0:
        return None
    window = candidate_window_atr(trading_mode)
    res = resistance_zones(
        reference=last,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=resistance_extras,
        window_atr=window,
    )
    sup = support_zones(
        reference=last,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=support_extras,
        window_atr=window,
    )
    return StructureSnapshot(
        last=round(last, 4),
        atr=round(atr, 4),
        trading_mode=str(trading_mode).strip().lower() or "swing",
        resistance=tuple(res),
        support=tuple(sup),
    )


def nearest_resistance_above(
    *,
    last: float,
    floor_above: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str = "swing",
    extra_levels: list[float | None] | None = None,
) -> LevelZone | None:
    """Nearest resistance zone above ``floor_above`` and ``last`` (ATR window)."""
    if last <= 0 or floor_above <= 0 or atr <= 0:
        return None
    window = candidate_window_atr(trading_mode)
    zones = resistance_zones(
        reference=last,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=extra_levels,
        window_atr=window,
    )
    eligible = [z for z in zones if z.level > floor_above + _TINY and z.level > last + _TINY]
    if not eligible:
        return None
    return min(eligible, key=lambda z: z.level)


def nearest_support_below(
    *,
    last: float,
    ceiling_below: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str = "swing",
    extra_levels: list[float | None] | None = None,
) -> LevelZone | None:
    """Nearest support zone below ``ceiling_below`` and ``last`` (ATR window)."""
    if last <= 0 or ceiling_below <= 0 or atr <= 0:
        return None
    window = candidate_window_atr(trading_mode)
    zones = support_zones(
        reference=last,
        atr=atr,
        daily_bars=daily_bars,
        extra_levels=extra_levels,
        window_atr=window,
    )
    eligible = [z for z in zones if z.level < ceiling_below - _TINY and z.level < last - _TINY]
    if not eligible:
        return None
    return max(eligible, key=lambda z: z.level)


def nearest_broken_resistance_at_or_below(
    *,
    last: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str = "swing",
    extra_levels: list[float | None] | None = None,
    window_atr: float = 1.5,
) -> LevelZone | None:
    """Breakout long anchor: highest resistance cluster at or just below ``last``."""
    if last <= 0 or atr <= 0:
        return None
    lo = last - window_atr * atr
    points = bar_extremes_with_recency(daily_bars, "high")
    points.extend(_positive_levels(extra_levels or []))
    epsilon = adaptive_epsilon(atr, last)
    zones = cluster_level_points(points, epsilon=epsilon, edge="low")
    eligible = [z for z in zones if lo - _TINY <= z.level <= last + _TINY]
    if not eligible:
        return None
    return max(eligible, key=lambda z: z.level)


def nearest_broken_support_at_or_above(
    *,
    last: float,
    atr: float,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str = "swing",
    extra_levels: list[float | None] | None = None,
    window_atr: float = 1.5,
) -> LevelZone | None:
    """Breakdown short anchor: lowest support cluster at or just above ``last``."""
    if last <= 0 or atr <= 0:
        return None
    hi = last + window_atr * atr
    points = bar_extremes_with_recency(daily_bars, "low")
    points.extend(_positive_levels(extra_levels or []))
    epsilon = adaptive_epsilon(atr, last)
    zones = cluster_level_points(points, epsilon=epsilon, edge="high")
    eligible = [z for z in zones if last - _TINY <= z.level <= hi + _TINY]
    if not eligible:
        return None
    return min(eligible, key=lambda z: z.level)
