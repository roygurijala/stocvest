from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from stocvest.api.handlers.scanner import (
    scanner_briefing_handler,
    scanner_catalysts_handler,
    scanner_gaps_handler,
    scanner_intraday_handler,
)


def test_scanner_gaps_handler_returns_ranked_candidates() -> None:
    event = {
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "GAP1", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000},
                    {"symbol": "FLAT", "prev_close": 50.0, "pre_market_price": 50.2, "day_volume": 1_000_000},
                ],
                "limit": 5,
                "min_abs_gap_percent": 2.0,
            }
        )
    }
    response = scanner_gaps_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "GAP1"


def test_scanner_catalysts_handler_returns_candidates() -> None:
    event = {
        "body": json.dumps(
            {
                "articles": [
                    {
                        "article_id": "a1",
                        "published_at": "2026-04-28T11:00:00+00:00",
                        "title": "GAP1 reports strong earnings beat",
                        "description": "Revenue guidance raised",
                        "url": "https://example.com/1",
                        "source": "Reuters",
                        "tickers": ["GAP1"],
                        "keywords": ["earnings"],
                        "sentiment": "bullish",
                        "sentiment_score": 0.55,
                    }
                ],
                "limit": 5,
                "min_score": 0.35,
            }
        )
    }
    response = scanner_catalysts_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "GAP1"


def test_scanner_intraday_handler_returns_setups() -> None:
    start = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars = []
    for i in range(15):
        close = 100.0 + ((i % 3) * 0.1)
        bars.append(_bar(start + timedelta(minutes=i), close=close, volume=120_000))
    bars.append(_bar(start + timedelta(minutes=15), close=100.2, volume=100_000))
    bars.append(_bar(start + timedelta(minutes=16), close=102.2, volume=350_000))

    event = {"body": json.dumps({"bars_by_symbol": {"GAP1": bars}, "limit": 5, "min_score": 0.35})}
    response = scanner_intraday_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) >= 1
    assert body[0]["symbol"] == "GAP1"


def test_scanner_briefing_handler_renders_markdown() -> None:
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
    response = scanner_briefing_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "GAP1" in body["markdown"]
    assert body["date_iso"] == "2026-04-28"


def test_scanner_handlers_validate_inputs() -> None:
    response = scanner_gaps_handler({"body": json.dumps({"snapshots": {}})}, {})
    assert response["statusCode"] == 400


def _bar(ts: datetime, *, close: float, volume: float) -> dict[str, object]:
    return {
        "timestamp": ts.isoformat(),
        "timeframe": "1min",
        "open": close,
        "high": close * 1.002,
        "low": close * 0.998,
        "close": close,
        "volume": volume,
    }

