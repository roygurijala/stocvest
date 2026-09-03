"""Tests for two-layer reference stop policy (structural + ATR floor)."""

from stocvest.api.services.reference_stop_policy import (
    MIN_SWING_STOP_DISTANCE_ATR,
    reference_stop_atr_k,
    resolve_merged_reference_stop,
    resolve_structural_stop_anchor,
)


def test_structural_long_anchor() -> None:
    stop = resolve_structural_stop_anchor(
        direction="bullish",
        session_low=98.0,
        session_high=102.0,
        vwap=99.5,
        prev_close=99.0,
        last=100.0,
    )
    assert stop == round(98.0 * 0.995, 4)


def test_structural_long_uses_swing_support_not_vwap_cluster() -> None:
    stop = resolve_structural_stop_anchor(
        direction="bullish",
        session_low=424.0,
        session_high=445.0,
        vwap=426.0,
        prev_close=425.0,
        last=427.0,
        swing_low=420.0,
        zone_lo=420.0,
    )
    assert stop == round(420.0 * 0.995, 4)
    assert stop < 422.0


def test_merged_long_widens_with_atr() -> None:
    stop, used = resolve_merged_reference_stop(
        direction="bullish",
        entry=100.0,
        structural_stop=99.5,
        atr=2.0,
        atr_k=1.0,
    )
    assert stop == 98.0
    assert used is True


def test_preset_k_values() -> None:
    assert reference_stop_atr_k(preset="dip") == 0.75
    assert reference_stop_atr_k(trading_mode="day") == 0.85
    assert reference_stop_atr_k(trading_mode="swing") == 2.0


def test_swing_min_stop_distance_widens_sub_dollar_setup() -> None:
    """UPWK-style: sub-$10 swing stop must clear ~6% / 1.5×ATR floor, not 2.5% day tier."""
    entry = 7.78
    structural = 7.59
    atr = 0.20
    stop, used = resolve_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=atr,
        atr_k=2.0,
        trading_mode="swing",
    )
    min_dist = max(1.5 * atr, entry * 0.06)
    assert stop is not None
    assert entry - stop >= min_dist - 1e-4
    assert stop <= entry - min_dist + 1e-4
    assert stop < structural
    assert used is True


def test_swing_merge_keeps_wider_stop_when_atr_band_is_tighter() -> None:
    """Swing long: structural below entry wins over a tighter ATR band above it."""
    stop, used = resolve_merged_reference_stop(
        direction="bullish",
        entry=100.0,
        structural_stop=93.0,
        atr=2.0,
        atr_k=2.0,
        trading_mode="swing",
    )
    assert stop == 93.0
    assert used is False


def test_day_merge_allows_tighter_atr_when_structure_is_wide() -> None:
    """Day long: when structure is already wide, prefer tighter ATR band."""
    stop, used = resolve_merged_reference_stop(
        direction="bullish",
        entry=100.0,
        structural_stop=95.0,
        atr=2.0,
        atr_k=0.85,
        trading_mode="day",
    )
    assert stop == 98.3
    assert used is True


def test_evc_style_swing_stop_meets_min_distance() -> None:
    """EVC alert (~$10 entry, ~3.5% stop) must widen under swing policy."""
    entry = 10.11
    structural = 9.76
    atr = 0.35
    stop, _ = resolve_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=atr,
        atr_k=2.0,
        trading_mode="swing",
    )
    assert stop is not None
    assert entry - stop >= max(1.5 * atr, entry * 0.06) - 1e-4
    assert (entry - stop) / atr >= MIN_SWING_STOP_DISTANCE_ATR - 0.01


def test_nvdq_style_swing_stop_meets_min_distance() -> None:
    """NVDQ alert (~$8.83 entry, ~2.5% stop) must widen under swing policy."""
    entry = 8.83
    structural = 8.61
    atr = 0.22
    stop, _ = resolve_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=atr,
        atr_k=2.0,
        trading_mode="swing",
    )
    assert stop is not None
    assert entry - stop >= max(1.5 * atr, entry * 0.06) - 1e-4
