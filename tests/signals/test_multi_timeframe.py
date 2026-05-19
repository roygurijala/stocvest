"""Multi-timeframe weekly bias tests (Chunk 7)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.multi_timeframe import (
    apply_timeframe_score_modifier,
    compute_weekly_bias,
    get_timeframe_alignment,
)


def _bars(closes: list[float]) -> list[Bar]:
    base = datetime(2026, 1, 2, tzinfo=timezone.utc)
    out: list[Bar] = []
    for i, close in enumerate(closes):
        o = close * 0.995
        out.append(
            Bar(
                symbol="TEST",
                timestamp=base + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=o,
                high=close * 1.01,
                low=close * 0.99,
                close=close,
                volume=1_000_000.0,
            )
        )
    return out


def test_weekly_bullish_close_above_open() -> None:
    # Last 5: rise from 100 -> 106
    closes = [95.0, 96.0, 97.0, 98.0, 99.0, 100.0, 102.0, 104.0, 105.0, 106.0]
    weekly = compute_weekly_bias(_bars(closes))
    assert weekly["weekly_bias"] == "bullish"
    assert weekly["weekly_change_pct"] > 0


def test_weekly_bearish_close_below_open() -> None:
    closes = [110.0, 109.0, 108.0, 107.0, 106.0, 105.0, 103.0, 101.0, 100.0, 98.0]
    weekly = compute_weekly_bias(_bars(closes))
    assert weekly["weekly_bias"] == "bearish"
    assert weekly["weekly_change_pct"] < 0


def test_weekly_neutral_flat() -> None:
    base = datetime(2026, 1, 2, tzinfo=timezone.utc)
    flat = [
        Bar(
            symbol="TEST",
            timestamp=base + timedelta(days=i),
            timeframe=Timeframe.DAY_1,
            open=100.0,
            high=100.0,
            low=100.0,
            close=100.0,
            volume=1_000_000.0,
        )
        for i in range(10)
    ]
    weekly = compute_weekly_bias(flat)
    assert weekly["weekly_bias"] == "neutral"


def test_aligned_both_bullish_modifier_positive_10() -> None:
    tf = get_timeframe_alignment("bullish", "bullish")
    assert tf["aligned"] is True
    assert tf["composite_score_modifier"] == 10


def test_counter_trend_modifier_negative_10() -> None:
    tf = get_timeframe_alignment("bullish", "bearish")
    assert tf["strength"] == "counter-trend"
    assert tf["composite_score_modifier"] == -10


def test_insufficient_bars_returns_neutral() -> None:
    weekly = compute_weekly_bias(_bars([100.0, 101.0, 102.0]))
    assert weekly["weekly_bias"] == "neutral"
    assert weekly["bars_used"] < 5


def test_overbought_labeled_correctly() -> None:
    closes = [80.0 + i * 2.5 for i in range(20)]
    weekly = compute_weekly_bias(_bars(closes))
    assert weekly["weekly_rsi"] >= 70.0
    assert "overbought" in weekly["weekly_note"].lower()


def test_oversold_labeled_correctly() -> None:
    closes = [120.0 - i * 2.5 for i in range(20)]
    weekly = compute_weekly_bias(_bars(closes))
    assert weekly["weekly_rsi"] <= 30.0
    assert "oversold" in weekly["weekly_note"].lower()


def test_apply_timeframe_modifier_clamps() -> None:
    assert apply_timeframe_score_modifier(0.0, 10) > 0.0
    assert apply_timeframe_score_modifier(0.8, -10) < 0.8
