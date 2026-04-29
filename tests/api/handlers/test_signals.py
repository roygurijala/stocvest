from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from stocvest.api.handlers.signals import (
    day_briefing_handler,
    day_setups_handler,
    swing_composite_handler,
    swing_synthesis_parse_handler,
)


def test_swing_composite_handler_returns_bullish_verdict() -> None:
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
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
    assert body["verdict"] == "bullish"
    assert body["score"] > 0
    assert len(body["contributions"]) == 3


def test_swing_synthesis_parse_handler_parses_json_verdict() -> None:
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


def test_day_setups_handler_returns_ranked_candidates() -> None:
    start = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = []
    for i in range(15):
        close = 100.0 + ((i % 3) * 0.1)
        bars.append(_bar_payload(start + timedelta(minutes=i), close=close, volume=120_000))
    bars.append(_bar_payload(start + timedelta(minutes=15), close=100.2, volume=100_000))
    bars.append(_bar_payload(start + timedelta(minutes=16), close=102.2, volume=350_000))

    event = {"body": json.dumps({"bars_by_symbol": {"GAP1": bars}, "limit": 5, "min_score": 0.35})}
    response = day_setups_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) >= 1
    assert body[0]["symbol"] == "GAP1"
    assert body[0]["direction"] in {"long", "short"}


def test_day_briefing_handler_renders_markdown() -> None:
    event = {
        "body": json.dumps(
            {
                "briefing_date": "2026-04-28",
                "gap_candidates": [
                    {
                        "symbol": "GAP1",
                        "prev_close": 100.0,
                        "premarket_price": 104.0,
                        "gap_percent": 4.0,
                        "day_volume": 12000000.0,
                        "direction": "up",
                        "rank_score": 4.8,
                    }
                ],
                "news_catalysts": [
                    {
                        "article_id": "a1",
                        "symbol": "GAP1",
                        "title": "Strong earnings beat",
                        "catalyst_type": "earnings",
                        "direction": "up",
                        "catalyst_score": 0.8,
                        "sentiment_score": 0.6,
                        "source": "Reuters",
                    }
                ],
                "pdt_assessment": {
                    "day_trades_in_window": 2,
                    "max_non_exempt": 3,
                    "rolling_business_days": 5,
                    "warn_near_limit": True,
                    "at_limit": False,
                    "pdt_exempt": False,
                },
                "market_session_summary": "Synthetic test session.",
            }
        )
    }
    response = day_briefing_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["date_iso"] == "2026-04-28"
    assert "GAP1" in body["markdown"]
    assert "PDT" in body["markdown"]


def test_day_setups_handler_validates_body() -> None:
    response = day_setups_handler({"body": json.dumps({"bars_by_symbol": []})}, {})
    assert response["statusCode"] == 400


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

