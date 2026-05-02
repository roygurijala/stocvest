from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import IntradaySetupScanner, SymbolLiquidityContext

_ET = ZoneInfo("America/New_York")

# Liquid context: prior-day vol proxy + price for gates / RVOL / ORB 30m rule
_LIQ_LIQUID = SymbolLiquidityContext(avg_daily_volume=8_000_000.0, last_price=100.0, company_name="Test Co")
_OPEN_VOL = 350_000.0


def bar(
    close: float,
    *,
    dt: datetime,
    symbol: str = "AAPL",
    high: float | None = None,
    low: float | None = None,
    volume: float = _OPEN_VOL,
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
                volume=_OPEN_VOL,
            )
        )
    return bars


@pytest.mark.unit
def test_scanner_detects_ranked_long_setup():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    bars = opening_block(base, "AAPL", high=101.0, low=99.0)
    bars.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="AAPL", volume=100_000),
            bar(102.2, dt=base + timedelta(minutes=16), symbol="AAPL", high=102.4, low=100.4, volume=400_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.5)
    results = scanner.scan({"AAPL": bars}, liquidity_by_symbol={"AAPL": _LIQ_LIQUID})

    assert len(results) == 1
    assert results[0].direction == "long"
    assert "orb_breakout_long" in results[0].triggers
    assert results[0].company_name == "Test Co"


@pytest.mark.unit
def test_scanner_detects_short_setup():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    bars = opening_block(base, "TSLA", high=101.0, low=99.0)
    bars.extend(
        [
            bar(99.6, dt=base + timedelta(minutes=15), symbol="TSLA", volume=100_000),
            bar(98.4, dt=base + timedelta(minutes=16), symbol="TSLA", high=99.0, low=98.2, volume=400_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.5)
    results = scanner.scan({"TSLA": bars}, liquidity_by_symbol={"TSLA": _LIQ_LIQUID})

    assert len(results) == 1
    assert results[0].direction == "short"
    assert "orb_breakout_short" in results[0].triggers


@pytest.mark.unit
def test_scanner_sorts_candidates_by_score():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    aapl = opening_block(base, "AAPL", high=101.0, low=99.0)
    msft = opening_block(base, "MSFT", high=101.0, low=99.0)
    aapl.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="AAPL", volume=100_000),
            bar(103.5, dt=base + timedelta(minutes=16), symbol="AAPL", high=103.7, low=100.4, volume=450_000),
        ]
    )
    msft.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="MSFT", volume=100_000),
            bar(102.8, dt=base + timedelta(minutes=16), symbol="MSFT", high=103.0, low=100.4, volume=400_000),
        ]
    )

    scanner = IntradaySetupScanner(min_score=0.5)
    results = scanner.scan(
        {"AAPL": aapl, "MSFT": msft},
        liquidity_by_symbol={"AAPL": _LIQ_LIQUID, "MSFT": _LIQ_LIQUID},
    )

    assert len(results) == 2
    assert results[0].score >= results[1].score
    assert results[0].symbol == "AAPL"


@pytest.mark.unit
def test_scanner_ignores_invalid_or_non_minute_bars():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    invalid = [bar(100.0, dt=base + timedelta(minutes=i), timeframe=Timeframe.MIN_5) for i in range(12)]
    mixed_symbol = [bar(100.0, dt=base + timedelta(minutes=i), symbol="AAA") for i in range(10)]
    mixed_symbol[-1] = bar(101.0, dt=base + timedelta(minutes=9), symbol="BBB")

    scanner = IntradaySetupScanner()
    results = scanner.scan({"BAD": invalid, "MIX": mixed_symbol}, liquidity_by_symbol={"BAD": _LIQ_LIQUID})
    assert results == []


@pytest.mark.unit
def test_scanner_rejects_orb_breakout_after_1000_et():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    bars = opening_block(base, "LATE", high=101.0, low=99.0)
    # Breakout at 10:05 ET — ORB invalid; need other triggers for score >= 0.5
    bars.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="LATE", volume=100_000),
            bar(100.1, dt=base + timedelta(minutes=30), symbol="LATE", volume=100_000),
            bar(102.2, dt=base + timedelta(minutes=35), symbol="LATE", high=102.4, low=100.4, volume=400_000),
        ]
    )
    scanner = IntradaySetupScanner(min_score=0.5)
    results = scanner.scan({"LATE": bars}, liquidity_by_symbol={"LATE": _LIQ_LIQUID})
    for r in results:
        assert not any(t.startswith("orb_") for t in r.triggers)


@pytest.mark.unit
def test_scanner_rejects_low_adv_when_liquidity_provided():
    base = datetime(2026, 4, 28, 9, 30, tzinfo=_ET)
    bars = opening_block(base, "ILLIQ", high=101.0, low=99.0)
    bars.extend(
        [
            bar(100.2, dt=base + timedelta(minutes=15), symbol="ILLIQ", volume=100_000),
            bar(102.2, dt=base + timedelta(minutes=16), symbol="ILLIQ", high=102.4, low=100.4, volume=400_000),
        ]
    )
    bad_liq = SymbolLiquidityContext(avg_daily_volume=500_000.0, last_price=100.0, company_name=None)
    scanner = IntradaySetupScanner(min_score=0.5)
    assert scanner.scan({"ILLIQ": bars}, liquidity_by_symbol={"ILLIQ": bad_liq}) == []
