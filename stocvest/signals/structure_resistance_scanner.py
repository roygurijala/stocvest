"""Structural support/resistance from daily OHLC — pivot highs/lows + recent extremes.

Used by swing/day composite geometry to anchor T2 on real price levels instead of
pure 2R math. When ``atr`` is supplied, delegates to the unified ``structure_engine``
(B80) with ATR-normalized windows; otherwise falls back to legacy pivot + % proximity.
"""

from __future__ import annotations

from typing import Any

from stocvest.api.services.structure_engine import (
    nearest_resistance_above as _zone_resistance_above,
    nearest_support_below as _zone_support_below,
)

# Fractal pivot: bars on each side that must be lower/higher than the center bar.
PIVOT_WINDOW = 2
# Recent sessions whose window extreme is always a candidate (unconfirmed pivots).
RECENT_WINDOW = 12
# Legacy-only: only surface levels within this % band of last.
DEFAULT_PROXIMITY_PCT = 25.0
# Daily bars serialized for resistance scan (engines pass up to this many sessions).
RESISTANCE_SCAN_LOOKBACK = 30


def _float_attr(bar: Any, key: str) -> float | None:
    if isinstance(bar, dict):
        raw = bar.get(key)
    else:
        raw = getattr(bar, key, None)
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def swing_pivot_values(
    bars: list[Any],
    attr: str,
    *,
    is_high: bool,
    pivot_window: int = PIVOT_WINDOW,
) -> list[float]:
    """Confirmed fractal swing pivots for ``high`` or ``low``."""
    vals: list[float] = []
    n = len(bars)
    if n < 2 * pivot_window + 1:
        return vals
    for i in range(pivot_window, n - pivot_window):
        center = _float_attr(bars[i], attr)
        if center is None:
            continue
        is_pivot = True
        for j in range(i - pivot_window, i + pivot_window + 1):
            if j == i:
                continue
            other = _float_attr(bars[j], attr)
            if other is None:
                is_pivot = False
                break
            if (is_high and other > center) or (not is_high and other < center):
                is_pivot = False
                break
        if is_pivot:
            vals.append(center)
    return vals


def _high_candidates(bars: list[Any], *, pivot_window: int, recent_window: int) -> list[float]:
    out: list[float] = []
    out.extend(swing_pivot_values(bars, "high", is_high=True, pivot_window=pivot_window))
    recent = bars[-recent_window:] if recent_window > 0 else bars
    highs = [_float_attr(b, "high") for b in recent]
    highs = [h for h in highs if h is not None]
    if highs:
        out.append(max(highs))
    return out


def _low_candidates(bars: list[Any], *, pivot_window: int, recent_window: int) -> list[float]:
    out: list[float] = []
    out.extend(swing_pivot_values(bars, "low", is_high=False, pivot_window=pivot_window))
    recent = bars[-recent_window:] if recent_window > 0 else bars
    lows = [_float_attr(b, "low") for b in recent]
    lows = [lo for lo in lows if lo is not None]
    if lows:
        out.append(min(lows))
    return out


def _legacy_nearest_resistance_above(
    bars: list[Any] | None,
    *,
    last: float,
    floor_above: float,
    proximity_pct: float,
    pivot_window: int,
    recent_window: int,
    extra_levels: list[float] | None,
    extra_proximity_pct: float | None,
) -> float | None:
    if not bars or last <= 0 or floor_above <= 0:
        return None
    hi_cap = last * (1.0 + proximity_pct / 100.0)
    extra_hi_cap = (
        last * (1.0 + extra_proximity_pct / 100.0) if extra_proximity_pct is not None else None
    )
    candidates: list[float] = []
    for level in _high_candidates(bars, pivot_window=pivot_window, recent_window=recent_window):
        if level > floor_above + 1e-6 and level > last + 1e-6 and level <= hi_cap + 1e-6:
            candidates.append(level)
    for raw in extra_levels or []:
        try:
            level = float(raw)
        except (TypeError, ValueError):
            continue
        if level <= floor_above + 1e-6 or level <= last + 1e-6:
            continue
        if extra_hi_cap is not None and level > extra_hi_cap + 1e-6:
            continue
        candidates.append(level)
    if not candidates:
        return None
    return round(min(candidates), 4)


def scan_nearest_resistance_above(
    bars: list[Any] | None,
    *,
    last: float,
    floor_above: float,
    proximity_pct: float = DEFAULT_PROXIMITY_PCT,
    pivot_window: int = PIVOT_WINDOW,
    recent_window: int = RECENT_WINDOW,
    extra_levels: list[float] | None = None,
    extra_proximity_pct: float | None = None,
    atr: float | None = None,
    trading_mode: str = "swing",
) -> float | None:
    """
    Nearest structural resistance strictly above ``floor_above`` and ``last``.

    When ``atr`` is provided, uses the B80 zone engine (ATR window, clustered levels).
    Analyst / external ``extra_levels`` are **never** passed to the zone engine — only
    the legacy path may include them (v2 T2 cap via ``extra_proximity_pct``).
    """
    if atr is not None and atr > 0 and bars:
        zone = _zone_resistance_above(
            last=last,
            floor_above=floor_above,
            atr=float(atr),
            daily_bars=bars,  # type: ignore[arg-type]
            trading_mode=trading_mode,
            extra_levels=None,
        )
        if zone is not None:
            return zone.level
        return None

    return _legacy_nearest_resistance_above(
        bars,
        last=last,
        floor_above=floor_above,
        proximity_pct=proximity_pct,
        pivot_window=pivot_window,
        recent_window=recent_window,
        extra_levels=extra_levels,
        extra_proximity_pct=extra_proximity_pct,
    )


def scan_nearest_support_below(
    bars: list[Any] | None,
    *,
    last: float,
    ceiling_below: float,
    proximity_pct: float = DEFAULT_PROXIMITY_PCT,
    pivot_window: int = PIVOT_WINDOW,
    recent_window: int = RECENT_WINDOW,
    extra_levels: list[float] | None = None,
    atr: float | None = None,
    trading_mode: str = "swing",
) -> float | None:
    """Nearest structural support strictly below ``ceiling_below`` and ``last``."""
    if atr is not None and atr > 0 and bars:
        zone = _zone_support_below(
            last=last,
            ceiling_below=ceiling_below,
            atr=float(atr),
            daily_bars=bars,  # type: ignore[arg-type]
            trading_mode=trading_mode,
            extra_levels=extra_levels,
        )
        if zone is not None:
            return zone.level
        return None

    if not bars or last <= 0 or ceiling_below <= 0:
        return None
    lo_cap = last * (1.0 - proximity_pct / 100.0)
    candidates: list[float] = []
    for level in _low_candidates(bars, pivot_window=pivot_window, recent_window=recent_window):
        if level < ceiling_below - 1e-6 and level < last - 1e-6 and level >= lo_cap - 1e-6:
            candidates.append(level)
    for raw in extra_levels or []:
        try:
            level = float(raw)
        except (TypeError, ValueError):
            continue
        if level < ceiling_below - 1e-6 and level < last - 1e-6:
            candidates.append(level)
    if not candidates:
        return None
    return round(max(candidates), 4)
