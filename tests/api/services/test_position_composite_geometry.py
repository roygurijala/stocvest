"""Unit tests for position composite geometry (POS-D5)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.geometry_tradeability import geometry_tradeability
from stocvest.api.services.position_composite_geometry import (
    _entry_for_geometry,
    _position_signal_complete,
    build_position_composite_geometry_fields,
    compute_weekly_atr,
)
from stocvest.api.services.signal_validation_eligibility import evaluate_position_desk_entry
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict
from stocvest.signals.position_technical_analyzer import PositionTechnicalLayerResult


def _weekly_bar(symbol: str, i: int, close: float, spread: float = 2.0) -> Bar:
    d0 = datetime(2022, 1, 3, tzinfo=timezone.utc)
    ts = d0 + timedelta(days=7 * i)
    return Bar(
        symbol=symbol,
        timestamp=ts,
        timeframe=Timeframe.WEEK_1,
        open=close - spread * 0.3,
        high=close + spread,
        low=close - spread,
        close=close,
        volume=5e6,
    )


def _daily_from_weekly(symbol: str, weekly: list[Bar]) -> list[Bar]:
    out: list[Bar] = []
    for i, w in enumerate(weekly):
        for d in range(5):
            out.append(
                Bar(
                    symbol=symbol,
                    timestamp=w.timestamp + timedelta(days=d),
                    timeframe=Timeframe.DAY_1,
                    open=w.open,
                    high=w.high,
                    low=w.low,
                    close=w.close + d * 0.01,
                    volume=w.volume / 5,
                )
            )
        _ = i
    return out


def _bullish_weekly_series(symbol: str, n: int, start: float = 100.0) -> list[Bar]:
    p = start
    out: list[Bar] = []
    for i in range(n):
        p *= 1.01
        out.append(_weekly_bar(symbol, i, p, spread=max(1.5, p * 0.02)))
    return out


@pytest.mark.unit
def test_compute_weekly_atr_requires_history() -> None:
    bars = _bullish_weekly_series("AAPL", 10)
    assert compute_weekly_atr(bars) is None
    bars = _bullish_weekly_series("AAPL", 20)
    atr = compute_weekly_atr(bars)
    assert atr is not None and atr > 0


@pytest.mark.unit
def test_large_cap_geometry_fields() -> None:
    weekly = _bullish_weekly_series("AAPL", 60, start=150.0)
    daily = _daily_from_weekly("AAPL", weekly)
    tech = PositionTechnicalLayerResult(
        status="available",
        score=72,
        verdict="bullish",
        weekly_sma50=165.0,
        weekly_sma200=140.0,
        weekly_bars_analyzed=60,
    )
    composite = CompositeSignal(
        score=0.35,
        confidence=0.8,
        verdict=CompositeVerdict.BULLISH,
        alignment_ratio=0.7,
        contributions=(),
        conflicted_layers=(),
    )
    snap = Snapshot(symbol="AAPL", last_trade_price=180.0, prev_close=178.0)
    env = {"min_rr_position": 1.5, "min_rr": 1.5, "environment_tier": "normal"}

    out = build_position_composite_geometry_fields(
        symbol="AAPL",
        composite=composite,
        daily_bars=daily,
        snapshot=snap,
        tech=tech,
        analyst_target_levels=[195.0, 200.0],
        analyst_target_source="benzinga",
        market_environment=env,
    )

    assert out.get("reference_stop_level") is not None
    assert out.get("reference_target_1") is not None
    assert out.get("atr_weekly") is not None
    assert out.get("historical_entry_zone") is not None
    assert out.get("min_rr_desk") == 1.5
    # Trending fixture: wide position stop vs nearby T1 → honest incomplete (sub-min R/R).
    assert out.get("status") == "incomplete"
    assert out.get("geometry_tradeable") is False
    assert "risk_reward" in (out.get("missing_fields") or [])


@pytest.mark.unit
def test_high_vol_geometry_wider_stop() -> None:
    weekly = _bullish_weekly_series("SOFI", 60, start=8.0)
    daily = _daily_from_weekly("SOFI", weekly)
    tech = PositionTechnicalLayerResult(
        status="available",
        score=65,
        verdict="bullish",
        weekly_sma50=9.5,
        weekly_sma200=7.5,
        weekly_bars_analyzed=60,
    )
    composite = CompositeSignal(
        score=0.25,
        confidence=0.7,
        verdict=CompositeVerdict.BULLISH,
        alignment_ratio=0.6,
        contributions=(),
        conflicted_layers=(),
    )
    snap = Snapshot(symbol="SOFI", last_trade_price=10.5, prev_close=10.2)
    env = {"min_rr_position": 1.5, "min_rr": 1.5}

    out = build_position_composite_geometry_fields(
        symbol="SOFI",
        composite=composite,
        daily_bars=daily,
        snapshot=snap,
        tech=tech,
        analyst_target_levels=None,
        analyst_target_source="none",
        market_environment=env,
    )

    stop = out.get("reference_stop_level")
    last = out.get("last_trade_price")
    assert stop is not None and last is not None
    assert float(last) - float(stop) >= float(last) * 0.08


@pytest.mark.unit
def test_entry_for_geometry_prefers_last() -> None:
    zone = {"low": 160.0, "high": 175.0}
    assert _entry_for_geometry(180.0, zone) == 180.0


@pytest.mark.unit
def test_position_signal_complete_requires_min_rr() -> None:
    body = {
        "historical_entry_zone": {"low": 1.0, "high": 2.0},
        "reference_stop_level": 0.5,
        "reference_target_1": 3.0,
    }
    ok, missing = _position_signal_complete(body, rr_struct=1.2, min_rr=1.5)
    assert ok is False
    assert "risk_reward_below_min" in missing


@pytest.mark.unit
def test_neutral_verdict_not_geometry_tradeable() -> None:
    weekly = _bullish_weekly_series("AAPL", 60, start=150.0)
    daily = _daily_from_weekly("AAPL", weekly)
    tech = PositionTechnicalLayerResult(
        status="available",
        score=50,
        verdict="neutral",
        weekly_sma50=165.0,
        weekly_bars_analyzed=60,
    )
    composite = CompositeSignal(
        score=0.0,
        confidence=0.5,
        verdict=CompositeVerdict.NEUTRAL,
        alignment_ratio=0.5,
        contributions=(),
        conflicted_layers=(),
    )
    out = build_position_composite_geometry_fields(
        symbol="AAPL",
        composite=composite,
        daily_bars=daily,
        snapshot=Snapshot(symbol="AAPL", last_trade_price=180.0),
        tech=tech,
        analyst_target_levels=None,
        analyst_target_source="none",
        market_environment={"min_rr_position": 1.5},
    )
    ok, reason = geometry_tradeability(out, mode="position")
    assert ok is False
    assert reason in ("neutral_verdict", "incomplete")


@pytest.mark.unit
def test_perplexity_analyst_excluded_from_t2_candidate() -> None:
    weekly = _bullish_weekly_series("AAPL", 60, start=150.0)
    daily = _daily_from_weekly("AAPL", weekly)
    tech = PositionTechnicalLayerResult(
        status="available",
        score=72,
        verdict="bullish",
        weekly_sma50=165.0,
        weekly_bars_analyzed=60,
    )
    composite = CompositeSignal(
        score=0.35,
        confidence=0.8,
        verdict=CompositeVerdict.BULLISH,
        alignment_ratio=0.7,
        contributions=(),
        conflicted_layers=(),
    )
    out = build_position_composite_geometry_fields(
        symbol="AAPL",
        composite=composite,
        daily_bars=daily,
        snapshot=Snapshot(symbol="AAPL", last_trade_price=180.0),
        tech=tech,
        analyst_target_levels=[250.0],
        analyst_target_source="perplexity",
        market_environment={"min_rr_position": 1.5},
    )
    assert out.get("reference_target_2_provenance") != "analyst_target"


@pytest.mark.unit
def test_position_desk_entry_blocked_in_crisis_environment() -> None:
    ok, gates = evaluate_position_desk_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        risk_reward=2.0,
        market_environment={
            "environment_tier": "crisis",
            "new_position_allowed": False,
            "min_rr_position": 1.5,
        },
    )
    assert ok is False
    assert gates["market_environment"]["pass"] is False
