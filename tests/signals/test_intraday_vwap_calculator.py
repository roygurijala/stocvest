from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import IntradayVWAPCalculator


def bar(
    close: float,
    *,
    dt: datetime,
    symbol: str = "AAPL",
    high: float | None = None,
    low: float | None = None,
    volume: float = 100_000,
) -> Bar:
    return Bar(
        symbol=symbol,
        timestamp=dt,
        timeframe=Timeframe.MIN_1,
        open=close,
        high=high if high is not None else close * 1.01,
        low=low if low is not None else close * 0.99,
        close=close,
        volume=volume,
    )


@pytest.mark.unit
def test_vwap_updates_incrementally_single_symbol():
    calc = IntradayVWAPCalculator()
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    u1 = calc.update(bar(100.0, dt=base, volume=100_000))
    u2 = calc.update(bar(110.0, dt=base + timedelta(minutes=1), volume=100_000))

    assert u1.vwap is not None
    assert u2.vwap is not None
    assert u2.vwap > u1.vwap
    assert calc.get_current_vwap("AAPL") == pytest.approx(u2.vwap)


@pytest.mark.unit
def test_vwap_resets_on_new_day_for_same_symbol():
    calc = IntradayVWAPCalculator()
    day1 = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    day2 = datetime(2026, 4, 29, 9, 30, tzinfo=timezone.utc)

    calc.update(bar(100.0, dt=day1, volume=100_000))
    update_day2 = calc.update(bar(200.0, dt=day2, volume=100_000))

    # After reset, first VWAP on new day should be close to the new bar's typical price.
    assert update_day2.vwap == pytest.approx(200.0, rel=0.01)
    assert update_day2.date_key == "2026-04-29"


@pytest.mark.unit
def test_vwap_maintains_independent_state_per_symbol():
    calc = IntradayVWAPCalculator()
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    aapl = calc.update(bar(100.0, dt=base, symbol="AAPL", volume=100_000))
    msft = calc.update(bar(300.0, dt=base, symbol="MSFT", volume=100_000))

    assert aapl.vwap != msft.vwap
    assert calc.get_current_vwap("AAPL") == pytest.approx(aapl.vwap)
    assert calc.get_current_vwap("MSFT") == pytest.approx(msft.vwap)


@pytest.mark.unit
def test_vwap_with_zero_volume_returns_none_until_positive_volume():
    calc = IntradayVWAPCalculator()
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    first = calc.update(bar(100.0, dt=base, volume=0.0))
    second = calc.update(bar(101.0, dt=base + timedelta(minutes=1), volume=100_000))

    assert first.vwap is None
    assert second.vwap is not None
