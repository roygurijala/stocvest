from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from stocvest.api.handlers.signals import (
    day_briefing_handler,
    day_setups_handler,
    public_performance_summary_handler,
    public_platform_signal_record_handler,
    public_recent_signals_handler,
    swing_composite_handler,
    swing_synthesis_parse_handler,
    user_signal_history_handler,
    user_signal_record_handler,
)
from stocvest.api.services.signal_recorder import (
    InMemorySignalRecorder,
    reset_signal_recorder_for_tests,
)
from stocvest.data.models import SignalRecord


def test_swing_composite_insufficient_data_returns_200_without_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.fetch_composite_market_status_payload_sync",
        lambda: {
            "is_market_open": False,
            "next_open": "Monday 09:30 AM ET",
            "market_session": "closed",
        },
    )
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "ZZZ",
                "price_at_signal": 100.0,
                "signals": [
                    {"layer": "technical", "score": 0.7, "confidence": 0.9},
                    {"layer": "news", "score": 0.5, "confidence": 0.8},
                ],
            }
        )
    }
    response = swing_composite_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"] == "insufficient_data"
    assert body["available_layers"] == 2
    assert body["required_layers"] == 3
    assert body["message"]
    assert body["market_status"]["market_session"] == "closed"
    assert body["market_status"]["is_market_open"] is False
    assert body["disclaimer"]
    assert mem.get_public_recent(limit=50) == []


def test_swing_composite_unavailable_layers_reduce_available_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.fetch_composite_market_status_payload_sync",
        lambda: {
            "is_market_open": True,
            "next_open": None,
            "market_session": "regular",
        },
    )
    event = {
        "body": json.dumps(
            {
                "regime": "sideways",
                "symbol": "X",
                "signals": [
                    {"layer": "technical", "score": 0.2, "confidence": 0.9},
                    {"layer": "news", "status": "unavailable", "score": 0.5},
                    {"layer": "macro", "status": "unavailable"},
                    {"layer": "sector", "score": None, "confidence": 0.8},
                ],
            }
        )
    }
    response = swing_composite_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"] == "insufficient_data"
    assert body["available_layers"] == 1


def test_swing_composite_handler_returns_bullish_signal_summary() -> None:
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "AAPL",
                "symbol_snapshot": {
                    "last_trade_price": 180.0,
                    "day_low": 175.0,
                    "day_high": 182.0,
                    "day_vwap": 179.0,
                },
                "news_catalyst": {"headline": "Supplier beat raises outlook", "sentiment": "positive"},
                "signals": [
                    {"layer": "technical", "score": 0.7, "confidence": 0.9},
                    {"layer": "news", "score": 0.5, "confidence": 0.8},
                    {"layer": "macro", "score": 0.4, "confidence": 0.7},
                ],
            }
        )
    }
    response = swing_composite_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["signal_summary"] == "bullish"
    assert body["disclaimer"]
    assert body["score"] > 0
    assert len(body["contributions"]) == 3
    assert "signal_strength" in body["contributions"][0]
    assert isinstance(body.get("signal_score"), int)
    assert 0 <= body["signal_score"] <= 100
    assert body["trend_strength"] in {"Strong", "Moderate", "Weak"}
    assert body["trend_direction"] in {"Uptrend", "Downtrend", "Sideways", "Reversing"}
    assert isinstance(body.get("risk_reward"), (int, float))
    assert body["market_regime"] == "Bullish"
    assert isinstance(body.get("catalysts"), list)
    assert isinstance(body.get("risk_factors"), list)
    assert len(body["risk_factors"]) >= 1
    assert isinstance(body.get("signal_parameters"), str) and body["signal_parameters"]
    assert body["historical_entry_zone"]["low"] == 175.0
    assert body["historical_entry_zone"]["high"] == 182.0


def test_swing_synthesis_parse_handler_parses_json_signal_payload() -> None:
    event = {
        "body": json.dumps(
            {
                "symbol": "spy",
                "response_text": (
                    '{"action":"buy","conviction":0.76,"confidence":0.81,'
                    '"position_size_pct":0.3,"stop_loss_pct":0.03,"take_profit_pct":0.09,'
                    '"rationale":"Bullish setup.","risks":["volatility"],"timeframe":"swing"}'
                ),
            }
        )
    }
    response = swing_synthesis_parse_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["symbol"] == "SPY"
    assert body["action"] == "buy"
    assert body["timeframe"] == "swing"
    assert body["signal_strength"] == pytest.approx(0.81)
    assert body["disclaimer"]


def test_day_setups_handler_returns_ranked_candidates() -> None:
    et = ZoneInfo("America/New_York")
    start = datetime(2026, 4, 28, 9, 30, tzinfo=et)
    bars = []
    for i in range(15):
        close = 100.0 + ((i % 3) * 0.1)
        bars.append(_bar_payload(start + timedelta(minutes=i), close=close, volume=350_000))
    bars.append(_bar_payload(start + timedelta(minutes=15), close=100.2, volume=100_000))
    bars.append(_bar_payload(start + timedelta(minutes=16), close=102.2, volume=400_000))

    event = {
        "body": json.dumps(
            {
                "bars_by_symbol": {"GAP1": bars},
                "limit": 5,
                "min_score": 0.5,
                "liquidity_by_symbol": {
                    "GAP1": {"avg_daily_volume": 8_000_000, "last_price": 100.0, "company_name": "Gap1 Inc"}
                },
            }
        )
    }
    response = day_setups_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) >= 1
    assert body[0]["symbol"] == "GAP1"
    assert body[0]["direction"] in {"long", "short"}
    assert body[0].get("disclaimer")
    assert body[0].get("company_name") == "Gap1 Inc"


def test_day_briefing_handler_returns_structured_brief() -> None:
    event = {
        "body": json.dumps(
            {
                "briefing_date": "2026-04-28",
                "pdt_assessment": {
                    "day_trades_in_window": 2,
                    "max_non_exempt": 3,
                    "rolling_business_days": 5,
                    "warn_near_limit": True,
                    "at_limit": False,
                    "pdt_exempt": False,
                },
                "morning_brief_context": {
                    "futures_spy_pct": 0.35,
                    "futures_qqq_pct": 0.4,
                    "vix_level": 17.5,
                    "vix_direction": "falling",
                    "regime": "Bullish",
                    "economic_events": [],
                    "earnings_today": [],
                    "gap_intelligence_items": [
                        {
                            "symbol": "GAP1",
                            "company_name": "",
                            "gap_pct": 4.0,
                            "gap_dollars": 4.0,
                            "prev_close": 100.0,
                            "current_price": 104.0,
                            "volume": 12_000_000,
                            "volume_vs_avg": 2.0,
                            "gap_quality_score": 90,
                            "catalyst": {
                                "headline": "Strong earnings beat",
                                "category": "earnings",
                                "sentiment": "bullish",
                                "score": 72,
                            },
                            "has_catalyst": True,
                            "no_catalyst_warning": None,
                        }
                    ],
                },
            }
        )
    }
    response = day_briefing_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["date_iso"] == "2026-04-28"
    assert body.get("disclaimer")
    assert body.get("pdt_status", {}).get("status") == "warning"
    assert body.get("top_watch", {}).get("symbol") == "GAP1"


def test_day_setups_handler_validates_body() -> None:
    response = day_setups_handler({"body": json.dumps({"bars_by_symbol": []})}, {})
    assert response["statusCode"] == 400


def test_public_recent_signals_returns_public_records(monkeypatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    for i in range(12):
        mem.record_signal(
            SignalRecord(
                signal_id=f"id{i}",
                symbol=f"T{i}",
                direction="bullish" if i % 2 == 0 else "bearish",
                signal_strength=70 + i,
                pattern="p",
                layer_scores={},
                price_at_signal=100.0,
                generated_at=now - timedelta(hours=30 + i),
            )
        )

    response = public_recent_signals_handler({}, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 12
    keys = set(body[0].keys())
    assert "signal_id" in keys
    assert "outcome" in keys
    assert "disclaimer" in keys
    assert body[0]["outcome"] == "pending"


def test_public_recent_signals_returns_empty_when_no_records(monkeypatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    response = public_recent_signals_handler({}, {})
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == []


def test_public_performance_summary_aggregates_outcomes(monkeypatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="a",
            symbol="AAA",
            direction="bullish",
            signal_strength=84,
            pattern="p",
            layer_scores={},
            price_at_signal=100,
            generated_at=now - timedelta(hours=30),
            resolved_1d=True,
            outcome_1d="correct",
            price_1d_after=101,
        )
    )
    mem.record_signal(
        SignalRecord(
            signal_id="b",
            symbol="BBB",
            direction="bearish",
            signal_strength=79,
            pattern="p",
            layer_scores={},
            price_at_signal=100,
            generated_at=now - timedelta(hours=30),
            resolved_1d=True,
            outcome_1d="incorrect",
            price_1d_after=101,
        )
    )
    mem.record_signal(
        SignalRecord(
            signal_id="c",
            symbol="CCC",
            direction="bullish",
            signal_strength=52,
            pattern="p",
            layer_scores={},
            price_at_signal=100,
            generated_at=now - timedelta(hours=30),
            resolved_1d=True,
            outcome_1d="neutral",
            price_1d_after=100.05,
        )
    )

    response = public_performance_summary_handler({}, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_signals_tracked"] == 3
    assert body["signals_evaluated"] == 3
    assert body["correct_direction_count"] == 1
    assert body["incorrect_direction_count"] == 1
    assert body["neutral_direction_count"] == 1
    assert body["directional_accuracy_percent"] == 50.0
    assert body["disclaimer"]


def test_public_platform_signal_record_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="pub1",
            symbol="SPY",
            direction="bullish",
            signal_strength=70,
            pattern="swing_composite",
            layer_scores={"technical": 0.6},
            price_at_signal=400.0,
            generated_at=now,
            user_id=None,
        )
    )
    event = {
        "requestContext": {"http": {"method": "GET", "path": "/v1/signals/records/pub1"}},
    }
    resp = public_platform_signal_record_handler(event, {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["signal_id"] == "pub1"
    assert body["signal_scope"] == "platform"


def test_public_platform_signal_record_hides_user_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="u1",
            symbol="QQQ",
            direction="bearish",
            signal_strength=60,
            pattern="swing_composite",
            layer_scores={},
            price_at_signal=300.0,
            generated_at=now,
            user_id="cognito-sub-xyz",
        )
    )
    event = {
        "requestContext": {"http": {"method": "GET", "path": "/v1/signals/records/u1"}},
    }
    resp = public_platform_signal_record_handler(event, {})
    assert resp["statusCode"] == 404


def test_user_signal_record_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    event = {"requestContext": {"http": {"method": "GET", "path": "/v1/signals/me/records/x"}}}
    resp = user_signal_record_handler(event, {})
    assert resp["statusCode"] == 401


def test_user_signal_record_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="mine",
            symbol="AAPL",
            direction="bullish",
            signal_strength=55,
            pattern="swing_composite",
            layer_scores={},
            price_at_signal=150.0,
            generated_at=now,
            user_id="user-42",
        )
    )
    event = {
        "requestContext": {
            "http": {"method": "GET", "path": "/v1/signals/me/records/mine"},
            "authorizer": {"claims": {"sub": "user-42"}},
        },
    }
    resp = user_signal_record_handler(event, {})
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["signal_scope"] == "user"


def test_user_signal_history_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    resp = user_signal_history_handler({"requestContext": {"http": {"method": "GET", "path": "/v1/signals/me/history"}}}, {})
    assert resp["statusCode"] == 401


def test_user_signal_history_returns_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="h1",
            symbol="XOM",
            direction="neutral",
            signal_strength=50,
            pattern="swing_composite",
            layer_scores={},
            price_at_signal=90.0,
            generated_at=now,
            user_id="user-99",
        )
    )
    event = {
        "requestContext": {
            "http": {"method": "GET", "path": "/v1/signals/me/history"},
            "authorizer": {"claims": {"sub": "user-99"}},
        },
    }
    resp = user_signal_history_handler(event, {})
    assert resp["statusCode"] == 200
    rows = json.loads(resp["body"])
    assert len(rows) == 1
    assert rows[0]["symbol"] == "XOM"


def _bar_payload(ts: datetime, *, close: float, volume: float) -> dict[str, object]:
    return {
        "timestamp": ts.isoformat(),
        "timeframe": "1min",
        "open": close,
        "high": close * 1.002,
        "low": close * 0.998,
        "close": close,
        "volume": volume,
    }

