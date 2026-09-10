"""Tests for position-desk reference stop policy (POS-D5)."""

from stocvest.api.services.position_reference_stop_policy import (
    MIN_POSITION_RR,
    MIN_POSITION_STOP_DISTANCE_ATR,
    POSITION_MIN_STOP_PCT,
    POSITION_STOP_ATR_K,
    position_reference_stop_atr_k,
    resolve_position_merged_reference_stop,
)
from stocvest.api.services.reference_stop_policy import reference_stop_atr_k


def test_position_atr_k_wider_than_swing() -> None:
    assert position_reference_stop_atr_k() == 3.0
    assert reference_stop_atr_k(trading_mode="position") == 3.0
    assert reference_stop_atr_k(trading_mode="swing") == 2.0


def test_large_cap_position_stop_meets_min_distance() -> None:
    """AAPL-style: ~$180 entry with ~$8 weekly ATR — stop must clear position floor."""
    entry = 180.0
    structural = 172.0
    weekly_atr = 8.0
    stop, used = resolve_position_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=weekly_atr,
    )
    min_dist = max(POSITION_STOP_ATR_K * weekly_atr, entry * POSITION_MIN_STOP_PCT)
    assert stop is not None
    assert entry - stop >= min_dist - 1e-4
    assert (entry - stop) / weekly_atr >= MIN_POSITION_STOP_DISTANCE_ATR - 0.05
    assert used is True


def test_high_vol_position_stop_wider_than_swing() -> None:
    """High-vol small cap: position policy must widen more than swing would."""
    entry = 12.0
    structural = 11.2
    weekly_atr = 1.1
    pos_stop, _ = resolve_position_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=weekly_atr,
    )
    from stocvest.api.services.reference_stop_policy import resolve_merged_reference_stop

    swing_stop, _ = resolve_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=weekly_atr,
        atr_k=2.0,
        trading_mode="swing",
    )
    assert pos_stop is not None and swing_stop is not None
    assert pos_stop <= swing_stop + 1e-6


def test_min_position_rr_constant() -> None:
    assert MIN_POSITION_RR == 1.5
