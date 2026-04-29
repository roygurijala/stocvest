from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import OpeningRangeBreakoutDetector


def make_bar(
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
        high=high if high is not None else close * 1.002,
        low=low if low is not None else close * 0.998,
        close=close,
        volume=volume,
    )


def opening_bars(base: datetime, n: int = 15) -> list[Bar]:
    bars: list[Bar] = []
    for i in range(n):
        price = 100.0 + (i % 3) * 0.2
        bars.append(
            make_bar(
                price,
                dt=base + timedelta(minutes=i),
                high=101.0,
                low=99.0,
                volume=120_000,
            )
        )
    return bars


@pytest.mark.unit
def test_detects_long_breakout():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_bars(base)
    bars.append(make_bar(101.5, dt=base + timedelta(minutes=15), high=101.7, low=101.2, volume=250_000))

    detector = OpeningRangeBreakoutDetector(
        opening_range_minutes=15, breakout_buffer_pct=0.05, min_volume_for_confirmation=200_000
    )
    signal = detector.detect(bars)

    assert signal is not None
    assert signal.direction == "long"
    assert signal.symbol == "AAPL"
    assert signal.volume_confirmed is True


@pytest.mark.unit
def test_detects_short_breakout():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_bars(base)
    bars.append(make_bar(98.4, dt=base + timedelta(minutes=15), high=98.8, low=98.2, volume=220_000))

    detector = OpeningRangeBreakoutDetector(opening_range_minutes=15, breakout_buffer_pct=0.05)
    signal = detector.detect(bars)

    assert signal is not None
    assert signal.direction == "short"


@pytest.mark.unit
def test_returns_none_when_no_breakout():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_bars(base)
    bars.extend(
        [
            make_bar(100.2, dt=base + timedelta(minutes=15), high=100.3, low=100.0, volume=150_000),
            make_bar(100.1, dt=base + timedelta(minutes=16), high=100.2, low=100.0, volume=140_000),
        ]
    )

    detector = OpeningRangeBreakoutDetector(opening_range_minutes=15, breakout_buffer_pct=0.2)
    signal = detector.detect(bars)
    assert signal is None


@pytest.mark.unit
def test_raises_for_mixed_symbols():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_bars(base)
    bars.append(make_bar(101.5, dt=base + timedelta(minutes=15), symbol="MSFT"))

    detector = OpeningRangeBreakoutDetector()
    with pytest.raises(ValueError, match="same symbol"):
        detector.detect(bars)
