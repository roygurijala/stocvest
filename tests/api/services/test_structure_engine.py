"""Unit tests for B80 unified structure engine."""

from __future__ import annotations

import pytest

from stocvest.api.services.structure_engine import (
    adaptive_epsilon,
    build_structure_snapshot,
    candidate_window_atr,
    nearest_resistance_above,
    nearest_support_below,
    resistance_zones,
    support_zones,
)


def _bars(highs: list[float], *, drop: float = 3.0) -> list[dict[str, float]]:
    return [{"low": h - drop, "high": h} for h in highs]


@pytest.mark.unit
def test_resistance_zones_cluster_repeated_highs() -> None:
    zones = resistance_zones(
        reference=100.0,
        atr=2.0,
        daily_bars=_bars([104.0, 104.1, 104.0]),
        extra_levels=None,
        window_atr=3.0,
    )
    assert len(zones) >= 1
    assert zones[0].touch_count >= 2
    assert zones[0].level == pytest.approx(104.0, abs=0.2)


@pytest.mark.unit
def test_support_zones_nearest_first() -> None:
    zones = support_zones(
        reference=98.0,
        atr=2.0,
        daily_bars=_bars([97.0, 96.0, 95.0]),
        extra_levels=None,
        window_atr=3.0,
    )
    assert len(zones) >= 1
    assert all(z.level < 98.0 for z in zones)
    assert zones[0].level >= zones[-1].level


@pytest.mark.unit
def test_nearest_resistance_uses_atr_window_not_pct() -> None:
    # Level at 130 is ~30% above 100 — legacy 25% band would drop it; ATR window (3*2=6) also drops it.
    bars = _bars([90.0] * 10 + [130.0] + [90.0] * 4)
    level = nearest_resistance_above(
        last=100.0,
        floor_above=105.0,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
    )
    assert level is None


@pytest.mark.unit
def test_nearest_resistance_finds_in_band_cluster() -> None:
    bars = _bars([101.0, 102.0, 103.0, 104.0, 105.0, 104.5, 103.5])
    zone = nearest_resistance_above(
        last=100.0,
        floor_above=101.0,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
    )
    assert zone is not None
    assert zone.level <= 106.0
    assert zone.touch_count >= 1


@pytest.mark.unit
def test_structure_snapshot_splits_support_and_resistance() -> None:
    snap = build_structure_snapshot(
        last=100.0,
        atr=2.0,
        daily_bars=_bars([96.0, 104.0, 98.0, 106.0]),
        trading_mode="swing",
        resistance_extras=[105.0],
        support_extras=[97.0],
    )
    assert snap is not None
    assert all(z.level > 100.0 for z in snap.resistance)
    assert all(z.level < 100.0 for z in snap.support)


@pytest.mark.unit
def test_candidate_window_atr_swing_wider_than_day() -> None:
    assert candidate_window_atr("swing") >= candidate_window_atr("day")


@pytest.mark.unit
def test_adaptive_epsilon_matches_target_geometry() -> None:
    assert adaptive_epsilon(0.5, 100.0) == pytest.approx(0.2)
    assert adaptive_epsilon(10.0, 100.0) == pytest.approx(3.0)
