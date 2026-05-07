"""Indicator scope taxonomy gates."""

from __future__ import annotations

from stocvest.signals.indicator_scope import (
    apply_swing_chip_labels,
    filter_chips_by_mode,
    is_chip_allowed,
    validate_chip_for_swing,
)


def test_vwap_below_blocked_in_swing() -> None:
    assert is_chip_allowed("VWAP Below", "swing") is False


def test_vwap_below_allowed_in_day() -> None:
    assert is_chip_allowed("VWAP Below", "day") is True


def test_orb_long_blocked_in_swing() -> None:
    assert is_chip_allowed("ORB Long ↑ $432.15", "swing") is False


def test_orb_long_allowed_in_day() -> None:
    assert is_chip_allowed("ORB Long ↑ $432.15", "day") is True


def test_ema9_session_blocked_in_swing() -> None:
    assert is_chip_allowed("EMA9 bounce (session)", "swing") is False


def test_sma50_allowed_in_swing() -> None:
    assert is_chip_allowed("Above SMA50", "swing") is True


def test_sma50_blocked_in_day() -> None:
    assert is_chip_allowed("Above SMA50", "day") is False


def test_rsi_allowed_both_modes() -> None:
    assert is_chip_allowed("RSI 47", "day") is True
    assert is_chip_allowed("RSI 47 (Daily)", "swing") is True


def test_filter_chips_removes_intraday_from_swing() -> None:
    chips = [
        "VWAP Below",
        "RSI 47",
        "EMA9 bounce (session)",
        "Above SMA50",
        "ORB Long ↑ $432.15",
    ]
    assert filter_chips_by_mode(chips, "swing") == ["RSI 47", "Above SMA50"]


def test_validate_chip_for_swing_vwap_fails() -> None:
    assert validate_chip_for_swing("VWAP $430.21") is False


def test_validate_chip_for_swing_daily_vwap_passes() -> None:
    assert validate_chip_for_swing("Below Daily VWAP") is True


def test_validate_chip_for_swing_ema9_bare_fails() -> None:
    assert validate_chip_for_swing("EMA9 Bounce") is False


def test_validate_chip_for_swing_ema9_daily_passes() -> None:
    assert validate_chip_for_swing("EMA9 Bounce (Daily)") is True


def test_apply_swing_labels_renames_ema9() -> None:
    assert apply_swing_chip_labels(["EMA9 bounce"]) == ["EMA9 Bounce (Daily)"]


def test_apply_swing_labels_leaves_sma_unchanged() -> None:
    assert apply_swing_chip_labels(["Above SMA50"]) == ["Above SMA50"]