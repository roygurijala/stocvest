"""Unit tests for the flag-gated position-technical gap fixes:
weekly MACD momentum confirmation + volume/breakout confirmation (ships dark).

Both modifiers default OFF → the structural score is byte-identical to the shipped
read. When enabled they add bounded, glass-box confirmation credit/haircut.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.config.signal_parameters import PositionTechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.position_technical_analyzer import (
    PositionTechnicalAnalyzer,
    _weekly_macd_state,
    _weekly_relative_volume,
)

pytestmark = pytest.mark.unit


def _daily_bars(closes: list[float], volumes: list[float] | None = None) -> list[Bar]:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    bars: list[Bar] = []
    for i, close in enumerate(closes):
        vol = volumes[i] if volumes is not None else 1_000_000.0
        bars.append(
            Bar(
                symbol="TST",
                timestamp=start + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=close,
                high=close * 1.01,
                low=close * 0.99,
                close=close,
                volume=vol,
            )
        )
    return bars


def _uptrend_daily(n: int = 320, *, last_week_volume: float = 1_000_000.0) -> list[Bar]:
    # Accelerating uptrend: price above SMA-50/200, near highs, with rising momentum.
    closes = [10.0 * (1.004 ** i) for i in range(n)]
    vols = [1_000_000.0] * n
    for i in range(max(0, n - 5), n):  # last ~week
        vols[i] = last_week_volume
    return _daily_bars(closes, vols)


def _weekly_bars(closes: list[float], volume: float = 1_000_000.0) -> list[Bar]:
    start = datetime(2023, 1, 2, tzinfo=timezone.utc)
    return [
        Bar(
            symbol="TST",
            timestamp=start + timedelta(weeks=i),
            timeframe=Timeframe.WEEK_1,
            open=c,
            high=c * 1.02,
            low=c * 0.98,
            close=c,
            volume=volume,
        )
        for i, c in enumerate(closes)
    ]


# ── helper-level -----------------------------------------------------------------


def test_weekly_macd_state_up_on_rising_closes() -> None:
    params = PositionTechnicalParameters()
    closes = [100.0 + 0.2 * i * i for i in range(60)]  # accelerating rise
    assert _weekly_macd_state(closes, params) == "up"


def test_weekly_macd_state_down_on_falling_closes() -> None:
    params = PositionTechnicalParameters()
    closes = [1000.0 - 0.2 * i * i for i in range(60)]  # accelerating decline
    assert _weekly_macd_state(closes, params) == "down"


def test_weekly_macd_state_none_when_insufficient() -> None:
    params = PositionTechnicalParameters()
    assert _weekly_macd_state([10.0, 11.0, 12.0], params) is None


def test_weekly_relative_volume_ratio() -> None:
    params = PositionTechnicalParameters(volume_lookback_weeks=4)
    bars = _weekly_bars([10, 11, 12, 13, 14], volume=1_000_000.0)
    bars[-1] = bars[-1].model_copy(update={"volume": 2_000_000.0})
    rvol = _weekly_relative_volume(bars, params)
    assert rvol is not None and rvol > 1.5


def test_weekly_relative_volume_none_when_insufficient() -> None:
    params = PositionTechnicalParameters(volume_lookback_weeks=12)
    assert _weekly_relative_volume(_weekly_bars([10, 11, 12]), params) is None


# ── analyzer-level: OFF is byte-identical; ON changes the read -------------------


def _score(params: PositionTechnicalParameters, bars: list[Bar]) -> int | None:
    res = PositionTechnicalAnalyzer().analyze("TST", bars, Snapshot(symbol="TST"), params)
    return res.score


def test_flags_off_is_byte_identical() -> None:
    bars = _uptrend_daily(last_week_volume=5_000_000.0)
    base = PositionTechnicalParameters()  # both flags default OFF
    res_off = PositionTechnicalAnalyzer().analyze("TST", bars, Snapshot(symbol="TST"), base)
    assert res_off.score is not None
    assert not any("MACD" in c for c in res_off.chips)
    assert not any("vol" in c.lower() for c in res_off.chips)


def test_momentum_confirmation_adds_credit_and_chip_on_uptrend() -> None:
    bars = _uptrend_daily()
    off = PositionTechnicalParameters()
    on = PositionTechnicalParameters(weekly_momentum_confirm_enabled=True)
    base = _score(off, bars)
    res_on = PositionTechnicalAnalyzer().analyze("TST", bars, Snapshot(symbol="TST"), on)
    assert base is not None and res_on.score is not None
    # Uptrend + rising MACD → momentum confirms → non-negative credit + chip.
    assert res_on.score >= base
    assert any("MACD momentum up" in c for c in res_on.chips)


def test_volume_confirmation_credits_breakout_on_high_volume() -> None:
    bars = _uptrend_daily(last_week_volume=6_000_000.0)
    off = PositionTechnicalParameters()
    on = PositionTechnicalParameters(volume_confirm_enabled=True, volume_lookback_weeks=8)
    base = _score(off, bars)
    res_on = PositionTechnicalAnalyzer().analyze("TST", bars, Snapshot(symbol="TST"), on)
    assert base is not None and res_on.score is not None
    assert res_on.score >= base
    assert any("Breakout vol" in c for c in res_on.chips)
