"""Structure engine breakout anchor helpers."""

from __future__ import annotations

import pytest

from stocvest.api.services.structure_engine import (
    nearest_broken_resistance_at_or_below,
    nearest_broken_support_at_or_above,
)


@pytest.mark.unit
def test_nearest_broken_resistance_at_or_below() -> None:
    bars = [{"low": 96.0, "high": 99.0}, {"low": 97.0, "high": 100.0}, {"low": 98.0, "high": 101.0}]
    zone = nearest_broken_resistance_at_or_below(
        last=102.0,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
        extra_levels=[101.0],
    )
    assert zone is not None
    assert zone.level <= 102.0
    assert zone.level >= 98.0


@pytest.mark.unit
def test_nearest_broken_support_at_or_above() -> None:
    bars = [{"low": 96.0, "high": 99.0}, {"low": 97.0, "high": 100.0}, {"low": 98.0, "high": 101.0}]
    zone = nearest_broken_support_at_or_above(
        last=96.5,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
        extra_levels=[97.0],
    )
    assert zone is not None
    assert zone.level >= 96.5
