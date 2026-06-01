"""Tests for two-layer reference stop policy (structural + ATR floor)."""

from stocvest.api.services.reference_stop_policy import (
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
