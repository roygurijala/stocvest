"""Unit tests for B78 target geometry v3 — bounded T1, multi-candidate T2, clustering."""

from __future__ import annotations

import pytest

from stocvest.api.services.target_geometry import (
    adaptive_epsilon,
    compute_long_geometry,
    compute_short_geometry,
    distance_in_atr,
    geometry_params,
)


def _bars(highs: list[float], *, drop: float = 3.0) -> list[dict[str, float]]:
    return [{"low": h - drop, "high": h} for h in highs]


def test_geometry_params_day_vs_swing() -> None:
    assert geometry_params("day") == {"t1_alpha": 0.8, "t1_beta": 2.0, "t2_beta": 2.5}
    assert geometry_params("swing") == {"t1_alpha": 1.5, "t1_beta": 3.0, "t2_beta": 4.0}
    assert geometry_params("SWING") == geometry_params("swing")
    assert geometry_params("anything") == geometry_params("swing")


def test_adaptive_epsilon_low_and_high_atr() -> None:
    # low ATR -> price floor dominates (0.2% of price)
    assert adaptive_epsilon(0.5, 100.0) == pytest.approx(0.2)
    # high ATR -> ATR term dominates (0.3 * ATR)
    assert adaptive_epsilon(10.0, 100.0) == pytest.approx(3.0)


def test_distance_in_atr() -> None:
    assert distance_in_atr(106.0, 100.0, 2.0) == 3.0
    assert distance_in_atr(94.0, 100.0, 2.0) == 3.0
    assert distance_in_atr(None, 100.0, 2.0) is None
    assert distance_in_atr(106.0, 100.0, 0.0) is None


def test_long_t1_structural_in_band() -> None:
    # entry 100, ATR 2 -> swing band [1.5*2, 3*2] = [3, 6]. Resistance cluster at 104 (dist 4).
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=97.0, daily_bars=_bars([104.0, 104.0, 104.0]), trading_mode="swing"
    )
    assert geo.target_1 == 104.0
    assert geo.target_1_source == "structural"


def test_long_t1_falls_to_atr_floor_when_nearest_too_close() -> None:
    # Only candidate at 101 (dist 1 < alpha*ATR=3) -> not in band -> entry + alpha*ATR = 103.
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=97.0, daily_bars=_bars([101.0]), trading_mode="swing"
    )
    assert geo.target_1 == 103.0
    assert geo.target_1_source == "atr_floor"


def test_long_t1_falls_to_atr_floor_when_only_far_levels() -> None:
    # 107 is beyond the candidate window (entry + 3*ATR = 106) so it's dropped; 101 is too close.
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=97.0, daily_bars=_bars([101.0, 107.0]), trading_mode="swing"
    )
    assert geo.target_1 == 103.0
    assert geo.target_1_source == "atr_floor"


def test_long_t2_prefers_structural_resistance() -> None:
    # Two clusters: 104 (T1) and 105.5 (next resistance). atr_ext=108, 2R=106 -> min = 105.5 (resistance).
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=97.0, daily_bars=_bars([104.0, 105.5]), trading_mode="swing"
    )
    assert geo.target_1 == 104.0
    assert geo.target_2 == 105.5
    assert geo.target_2_provenance == "resistance"


def test_long_t2_uses_r_multiple_fallback_when_no_structure_above_t1() -> None:
    # T1 floor=103, no structural above. atr_ext=108, 2R(stop97)=106 -> min=106 (2r_extension).
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=97.0, daily_bars=_bars([101.0]), trading_mode="swing"
    )
    assert geo.target_2 == 106.0
    assert geo.target_2_provenance == "2r_extension"


def test_long_t2_atr_extension_when_smaller_than_2r() -> None:
    # Wide stop -> 2R huge; ATR extension (entry + 4*ATR = 108) is the nearest unanchored candidate.
    geo = compute_long_geometry(
        entry=100.0, atr=2.0, stop=80.0, daily_bars=_bars([101.0]), trading_mode="swing"
    )
    assert geo.target_2 == 108.0
    assert geo.target_2_provenance == "atr_extension"


def test_long_geometry_empty_without_atr() -> None:
    geo = compute_long_geometry(
        entry=100.0, atr=0.0, stop=97.0, daily_bars=_bars([104.0]), trading_mode="swing"
    )
    assert geo.target_1 is None and geo.target_2 is None


def test_sma_levels_enrich_resistance_candidates() -> None:
    # No daily-bar highs above entry, but SMA50 sits at 104 (dist 4, in band) -> structural T1.
    geo = compute_long_geometry(
        entry=100.0,
        atr=2.0,
        stop=97.0,
        daily_bars=_bars([98.0, 99.0]),
        trading_mode="swing",
        sma50=104.0,
    )
    assert geo.target_1 == 104.0
    assert geo.target_1_source == "structural"


def test_short_mirror_t1_structural_and_t2_fallback() -> None:
    # entry 100, ATR 2, support cluster at 96 (dist 4, in band) -> T1=96; 2R(stop103)=94.
    geo = compute_short_geometry(
        entry=100.0,
        atr=2.0,
        stop=103.0,
        daily_bars=[{"low": lo, "high": lo + 3.0} for lo in (96.0, 96.0)],
        trading_mode="swing",
    )
    assert geo.target_1 == 96.0
    assert geo.target_1_source == "structural"
    assert geo.target_2 == 94.0
    assert geo.target_2_provenance == "2r_extension"


def test_day_band_tighter_than_swing() -> None:
    # Day band [0.8*2, 2*2] = [1.6, 4]. A level at 102 (dist 2) qualifies for day, not swing.
    day = compute_long_geometry(
        entry=100.0, atr=2.0, stop=98.0, daily_bars=_bars([102.0]), trading_mode="day"
    )
    assert day.target_1 == 102.0 and day.target_1_source == "structural"
    swing = compute_long_geometry(
        entry=100.0, atr=2.0, stop=98.0, daily_bars=_bars([102.0]), trading_mode="swing"
    )
    # 102 is dist 2 < swing alpha*ATR (3) -> atr floor at 103.
    assert swing.target_1 == 103.0 and swing.target_1_source == "atr_floor"
