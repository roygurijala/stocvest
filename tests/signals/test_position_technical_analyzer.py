"""Tests for :mod:`stocvest.signals.position_technical_analyzer` (POS-D3)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.config.signal_parameters import PositionTechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.position_technical_analyzer import (
    PositionTechnicalAnalyzer,
    aggregate_daily_to_weekly_bars,
    _relative_strength_pct,
)


def _daily(
    symbol: str,
    i: int,
    close: float,
    *,
    start: datetime | None = None,
    volume: float = 5e6,
) -> Bar:
    d0 = start or datetime(2022, 1, 3, tzinfo=timezone.utc)
    return Bar(
        symbol=symbol,
        timestamp=d0 + timedelta(days=i),
        timeframe=Timeframe.DAY_1,
        open=close * 0.998,
        high=close * 1.01,
        low=close * 0.99,
        close=close,
        volume=volume,
    )


def _uptrend_daily(symbol: str, n: int, *, trend: float = 0.003) -> list[Bar]:
    price = 100.0
    out: list[Bar] = []
    for i in range(n):
        price *= 1.0 + trend
        out.append(_daily(symbol, i, price))
    return out


def test_aggregate_daily_to_weekly_bars_groups_by_iso_week() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    bars = [_daily("TEST", i, 100.0 + i, start=start) for i in range(10)]
    weekly = aggregate_daily_to_weekly_bars(bars, "TEST")
    assert len(weekly) >= 2
    assert all(b.timeframe == Timeframe.WEEK_1 for b in weekly)
    assert weekly[-1].close == bars[-1].close


def test_relative_strength_pct_outperform() -> None:
    subject = [100.0, 110.0, 120.0, 130.0, 140.0, 150.0, 160.0]
    bench = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0]
    rs = _relative_strength_pct(subject, bench, lookback=5)
    assert rs is not None
    assert rs > 10.0


def test_relative_strength_pct_rejects_non_positive_base() -> None:
    assert _relative_strength_pct([100.0, -50.0, 60.0], [100.0, 101.0, 102.0], 1) is None


@pytest.mark.parametrize("days", [10, 25])
def test_insufficient_weekly_history_unavailable(days: int) -> None:
    bars = _uptrend_daily("TEST", days)
    res = PositionTechnicalAnalyzer().analyze(
        "TEST",
        bars,
        Snapshot(symbol="TEST", last_trade_price=bars[-1].close),
        PositionTechnicalParameters(),
    )
    assert res.status == "unavailable"
    assert res.score is None


def test_full_weekly_score_available_with_52_weeks() -> None:
    # ~380 calendar days → ≥52 ISO weeks when aggregated
    bars = _uptrend_daily("TEST", 380, trend=0.002)
    spy_bars = _uptrend_daily("SPY", 380, trend=0.001)
    spy_weekly = aggregate_daily_to_weekly_bars(spy_bars, "SPY")
    res = PositionTechnicalAnalyzer().analyze(
        "TEST",
        bars,
        Snapshot(symbol="TEST", last_trade_price=bars[-1].close),
        PositionTechnicalParameters(),
        spy_weekly_bars=spy_weekly,
    )
    assert res.status == "available"
    assert res.score is not None
    assert res.score >= 60
    assert res.verdict == "bullish"
    assert any("W-SMA50" in c for c in res.chips)
    assert res.rs_vs_spy_6m_pct is not None


def test_degraded_status_between_26_and_51_weeks() -> None:
    bars = _uptrend_daily("TEST", 200, trend=0.002)
    res = PositionTechnicalAnalyzer().analyze(
        "TEST",
        bars,
        Snapshot(symbol="TEST"),
        PositionTechnicalParameters(),
    )
    assert res.status == "as_of_close"
    assert res.score is not None
    assert any("Limited weekly history" in c for c in res.chips)


def test_downtrend_bearish_verdict() -> None:
    bars = _uptrend_daily("TEST", 300, trend=0.002)
    tail_start = len(bars) - 80
    price = bars[tail_start].close
    for i in range(tail_start, len(bars)):
        price *= 0.985
        bars[i] = _daily("TEST", i, price)
    res = PositionTechnicalAnalyzer().analyze(
        "TEST",
        bars,
        Snapshot(symbol="TEST"),
        PositionTechnicalParameters(),
    )
    assert res.score is not None
    assert res.score <= 45
    assert res.verdict == "bearish"
