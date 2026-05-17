from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.config.signal_parameters import SignalParameters, SwingTechnicalParameters, TechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.day_technical_close_fallback import (
    AS_OF_CLOSE_COMPOSITE_CONFIDENCE,
    composite_confidence_for_technical_status,
    intraday_technical_needs_close_fallback,
    resolve_day_technical_layer,
    swing_to_technical_as_of_close,
)
from stocvest.signals.swing_technical_analyzer import SwingTechnicalLayerResult
from stocvest.signals.technical_analyzer import TechnicalAnalyzer, TechnicalLayerResult


def _daily_bars(n: int = 80, *, close: float = 100.0) -> list[Bar]:
    out: list[Bar] = []
    base = datetime(2024, 1, 2, tzinfo=timezone.utc)
    for i in range(n):
        out.append(
            Bar(
                symbol="NFLX",
                timestamp=base + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=close,
                high=close + 1,
                low=close - 1,
                close=close + (i % 5) * 0.1,
                volume=1_000_000,
            )
        )
    return out


def test_intraday_unavailable_triggers_fallback_predicate() -> None:
    tech = TechnicalLayerResult(
        status="unavailable",
        score=None,
        verdict="neutral",
        error="insufficient_bars",
    )
    assert intraday_technical_needs_close_fallback(tech) is True


def test_swing_to_technical_as_of_close_maps_fields() -> None:
    swing = SwingTechnicalLayerResult(
        status="available",
        score=62,
        verdict="bullish",
        daily_rsi=55.0,
        sma50=90.0,
        sma200=80.0,
        bars_analyzed=80,
        reasoning="Daily RSI 55.",
        chips=["Above SMA50", "RSI 55"],
    )
    tech = swing_to_technical_as_of_close(swing, symbol="NFLX")
    assert tech.status == "as_of_close"
    assert tech.score == 62
    assert tech.verdict == "bullish"
    assert "As of close" in (tech.chips[0] if tech.chips else "")
    assert "daily" in tech.reasoning.lower()
    assert tech.vwap_chip is not None


def test_resolve_day_technical_uses_daily_when_intraday_empty() -> None:
    params = SignalParameters()
    snap = Snapshot(symbol="NFLX", last_trade_price=100.0, prev_close=99.0)
    tech = resolve_day_technical_layer(
        symbol="NFLX",
        intraday_bars=[],
        snapshot=snap,
        technical_params=params.technical,
        swing_params=params.swing_technical,
        daily_bars=_daily_bars(),
    )
    assert tech.status == "as_of_close"
    assert tech.score is not None
    assert 0 <= tech.score <= 100


def test_composite_confidence_reduced_for_as_of_close() -> None:
    assert composite_confidence_for_technical_status("available") == 1.0
    assert composite_confidence_for_technical_status("as_of_close") == AS_OF_CLOSE_COMPOSITE_CONFIDENCE
    assert composite_confidence_for_technical_status("unavailable") == 0.0
