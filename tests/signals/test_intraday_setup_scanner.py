from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import IntradaySetupScanner


def bar(
    close: float,
    *,
    dt: datetime,
    symbol: str = "AAPL",
    high: float | None = None,
    low: float | None = None,
    volume: float = 100_000,
    timeframe: Timeframe = Timeframe.MIN_1,
) -> Bar:
    return Bar(
        symbol=symbol,
        timestamp=dt,
        timeframe=timeframe,
        open=close,
        high=high if high is not None else close * 1.002,
        low=low if low is not None else close * 0.998,
        close=close,
        volume=volume,
    )


def opening_block(base: datetime, symbol: str, *, high: float, low: float) -> list[Bar]:
    bars: list[Bar] = []
    for i in range(15):
        bars.append(
            bar(
                100.0 + ((i % 3) * 0.1),
                dt=base + timedelta(minutes=i),
                symbol=symbol,
                high=high,
                low=low,
                volume=120_000,
            )
        )
    return bars


@pytest.mark.unit
def test_scanner_detects_ranked_long_setup():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_block(base, "AAPL", high=101.0, low=99.0)
    bars.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="AAPL", volume=100_000),
            bar(102.2, dt=base + timedelta(minutes=16), symbol="AAPL", high=102.4, low=100.4, volume=350_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.35)
    results = scanner.scan({"AAPL": bars})

    assert len(results) == 1
    assert results[0].direction == "long"
    assert "orb_breakout_long" in results[0].triggers


@pytest.mark.unit
def test_scanner_detects_short_setup():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = opening_block(base, "TSLA", high=101.0, low=99.0)
    bars.extend(
        [
            bar(99.6, dt=base + timedelta(minutes=15), symbol="TSLA", volume=100_000),
            bar(98.4, dt=base + timedelta(minutes=16), symbol="TSLA", high=99.0, low=98.2, volume=320_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.35)
    results = scanner.scan({"TSLA": bars})

    assert len(results) == 1
    assert results[0].direction == "short"
    assert "orb_breakout_short" in results[0].triggers


@pytest.mark.unit
def test_scanner_sorts_candidates_by_score():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    aapl = opening_block(base, "AAPL", high=101.0, low=99.0)
    msft = opening_block(base, "MSFT", high=101.0, low=99.0)
    aapl.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="AAPL", volume=100_000),
            bar(102.3, dt=base + timedelta(minutes=16), symbol="AAPL", volume=420_000),
        ]
    )
    msft.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="MSFT", volume=100_000),
            bar(101.1, dt=base + timedelta(minutes=16), symbol="MSFT", volume=110_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.30)
    results = scanner.scan({"AAPL": aapl, "MSFT": msft})

    assert len(results) == 2
    assert results[0].score >= results[1].score
    assert results[0].symbol == "AAPL"


@pytest.mark.unit
def test_scanner_ignores_invalid_or_non_minute_bars():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    invalid = [bar(100.0, dt=base + timedelta(minutes=i), timeframe=Timeframe.MIN_5) for i in range(12)]
    mixed_symbol = [bar(100.0, dt=base + timedelta(minutes=i), symbol="AAA") for i in range(10)]
    mixed_symbol[-1] = bar(101.0, dt=base + timedelta(minutes=9), symbol="BBB")

    scanner = IntradaySetupScanner()
    results = scanner.scan({"BAD": invalid, "MIX": mixed_symbol})
    assert results == []
