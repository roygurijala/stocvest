"""Per-symbol scanner evaluation trace (B33 phase 1)."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import IntradaySetupScanner, SymbolLiquidityContext
from stocvest.signals.scanner_evaluation_trace import (
    build_intraday_evaluation_traces,
    diagnose_intraday_early_gates,
)


def _bar(sym: str, close: float, vol: float, minute: int) -> Bar:
    return Bar(
        symbol=sym,
        timestamp=datetime(2026, 5, 16, 14, minute, tzinfo=timezone.utc),
        timeframe=Timeframe.MIN_1,
        open=close,
        high=close + 0.1,
        low=close - 0.1,
        close=close,
        volume=vol,
    )


def test_diagnose_session_rvol_shortfall() -> None:
    sym = "NVDA"
    bars = [_bar(sym, 100.0, 10_000.0, m) for m in range(30)]
    liq = SymbolLiquidityContext(avg_daily_volume=50_000_000.0, last_price=100.0)
    trace = diagnose_intraday_early_gates(sym, bars, liq)
    assert trace is not None
    assert trace["gate"] == "session_rvol"
    assert "below expected intraday pace" in trace["detail"]
    assert trace["margin_pct"] is not None


def test_build_intraday_trace_score_floor() -> None:
    sym = "AAPL"
    bars = [_bar(sym, 150.0, 2_000_000.0, m) for m in range(30)]
    liq = SymbolLiquidityContext(avg_daily_volume=50_000_000.0, last_price=150.0)
    scanner = IntradaySetupScanner(min_score=0.0)
    probe = scanner._scan_symbol(sym, bars, liq)
    assert probe is not None
    traces = build_intraday_evaluation_traces(
        {sym: bars},
        liquidity_by_symbol={sym: liq},
        min_score=0.99,
        exclude_symbols=set(),
        limit=5,
    )
    assert len(traces) == 1
    assert traces[0]["gate"] == "score_floor"
    assert traces[0]["symbol"] == "AAPL"
    assert traces[0]["score"] is not None


def test_build_intraday_trace_excludes_qualifying_symbols() -> None:
    sym = "AAPL"
    bars = [_bar(sym, 150.0, 2_000_000.0, m) for m in range(30)]
    liq = SymbolLiquidityContext(avg_daily_volume=50_000_000.0, last_price=150.0)
    traces = build_intraday_evaluation_traces(
        {sym: bars},
        liquidity_by_symbol={sym: liq},
        min_score=0.01,
        exclude_symbols={"AAPL"},
        limit=5,
    )
    assert traces == []
