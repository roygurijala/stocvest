"""Structural resistance scanner — pivot highs/lows for T2 anchoring."""

from __future__ import annotations

from stocvest.signals.structure_resistance_scanner import (
    scan_nearest_resistance_above,
    scan_nearest_support_below,
    swing_pivot_values,
)


def _bars(highs: list[float], *, base_low: float = 1.0) -> list[dict[str, float]]:
    return [{"low": base_low, "high": h} for h in highs]


def test_swing_pivot_detects_local_high() -> None:
    # Center bar 13.5 is a pivot high (neighbors lower)
    highs = [10.0, 11.0, 12.0, 13.5, 12.5, 11.8, 11.0]
    pivots = swing_pivot_values(_bars(highs), "high", is_high=True, pivot_window=2)
    assert 13.5 in pivots


def test_ubxg_like_no_resistance_above_session_high_in_band() -> None:
    """Parabolic micro-cap: session high is T1; no structural level below 2R fantasy."""
    last = 9.44
    t1 = 11.40
    bars = _bars([3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4], base_low=2.0)
    level = scan_nearest_resistance_above(bars, last=last, floor_above=t1, proximity_pct=25.0)
    assert level is None


def test_analyst_target_fills_resistance_when_chart_empty() -> None:
    last = 9.44
    t1 = 11.40
    bars = _bars([3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4], base_low=2.0)
    level = scan_nearest_resistance_above(
        bars,
        last=last,
        floor_above=t1,
        proximity_pct=25.0,
        extra_levels=[12.0],
    )
    assert level == 12.0


def test_nearest_resistance_above_t1_picks_closest_pivot() -> None:
    last = 100.0
    t1 = 105.0
    # Pivot at 112 and farther pivot at 118 — want nearest above T1
    highs = [98.0, 99.0, 100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0, 111.0, 112.0, 111.0, 110.0, 109.0, 108.0]
    bars = _bars(highs)
    level = scan_nearest_resistance_above(bars, last=last, floor_above=t1, proximity_pct=25.0)
    assert level == 112.0


def test_resistance_outside_proximity_band_omitted() -> None:
    last = 100.0
    t1 = 105.0
    highs = [90.0] * 10 + [130.0] + [90.0] * 4
    bars = _bars(highs)
    level = scan_nearest_resistance_above(bars, last=last, floor_above=t1, proximity_pct=25.0)
    assert level is None


def test_scan_with_atr_ignores_analyst_extras() -> None:
    bars = _bars([3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4], base_low=2.0)
    assert (
        scan_nearest_resistance_above(
            bars,
            last=9.44,
            floor_above=11.4,
            extra_levels=[12.0],
            atr=0.5,
            trading_mode="swing",
        )
        is None
    )
    last = 100.0
    t1 = 95.0
    lows = [100.0, 99.0, 98.0, 97.0, 96.0, 95.0, 94.0, 93.0, 92.0, 91.0, 90.0, 89.0, 88.0, 87.0, 86.0, 87.0, 88.0, 89.0]
    bars = [{"low": lo, "high": lo + 2.0} for lo in lows]
    level = scan_nearest_support_below(bars, last=last, ceiling_below=t1, proximity_pct=25.0)
    assert level is not None
    assert level < t1
    assert level < last
