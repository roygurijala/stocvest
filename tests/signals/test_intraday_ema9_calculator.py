from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import IntradayEMA9Calculator


def make_bar(
    close: float,
    *,
    dt: datetime,
    symbol: str = "AAPL",
    timeframe: Timeframe = Timeframe.MIN_1,
) -> Bar:
    return Bar(
        symbol=symbol,
        timestamp=dt,
        timeframe=timeframe,
        open=close,
        high=close * 1.002,
        low=close * 0.998,
        close=close,
        volume=100_000,
    )


@pytest.mark.unit
def test_ema9_requires_nine_bars_to_seed():
    calc = IntradayEMA9Calculator()
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    for i in range(8):
        update = calc.update(make_bar(100 + i, dt=base + timedelta(minutes=i)))
        assert update.ema9 is None

    seeded = calc.update(make_bar(108, dt=base + timedelta(minutes=8)))
    assert seeded.ema9 == pytest.approx(104.0, abs=1e-4)
    assert calc.get_current_ema("AAPL") == pytest.approx(104.0, abs=1e-4)


@pytest.mark.unit
def test_ema9_updates_incrementally_after_seed():
    calc = IntradayEMA9Calculator()
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 110]
    for i, close in enumerate(closes):
        update = calc.update(make_bar(close, dt=base + timedelta(minutes=i)))

    assert update.ema9 is not None
    # Seed EMA(9)=104.0; next value with close=110 and k=0.2 -> 105.2
    assert update.ema9 == pytest.approx(105.2, abs=1e-4)


@pytest.mark.unit
def test_ema9_resets_for_new_day():
    calc = IntradayEMA9Calculator()
    day1 = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    day2 = datetime(2026, 4, 29, 9, 30, tzinfo=timezone.utc)

    for i in range(9):
        calc.update(make_bar(100 + i, dt=day1 + timedelta(minutes=i)))
    assert calc.get_current_ema("AAPL") is not None

    reset = calc.update(make_bar(130, dt=day2))
    assert reset.ema9 is None
    assert reset.bars_seen_today == 1


@pytest.mark.unit
def test_ema9_requires_one_minute_bars():
    calc = IntradayEMA9Calculator()
    bad_bar = make_bar(
        100,
        dt=datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc),
        timeframe=Timeframe.MIN_5,
    )
    with pytest.raises(ValueError, match="1-minute bars"):
        calc.update(bad_bar)
