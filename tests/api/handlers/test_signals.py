from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from stocvest.api.handlers.signals import (
    day_briefing_handler,
    day_setups_handler,
    public_performance_summary_handler,
    public_recent_signals_handler,
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


class _FakeDynamoTable:
    def __init__(self, items: list[dict[str, object]], *, raises: Exception | None = None) -> None:
        self._items = items
        self._raises = raises

    def scan(self, **kwargs: object) -> dict[str, object]:
        _ = kwargs
        if self._raises is not None:
            raise self._raises
        return {"Items": self._items}


class _FakeDynamoResource:
    def __init__(self, table: _FakeDynamoTable) -> None:
        self._table = table

    def Table(self, name: str) -> _FakeDynamoTable:
        _ = name
        return self._table


class _FakeClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


def test_public_recent_signals_returns_sanitized_latest_10(monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    items = []
    for i in range(12):
        items.append(
            {
                "symbol": f"T{i}",
                "direction": "long" if i % 2 == 0 else "short",
                "confidence": 70 + i,
                "timestamp_iso": (now - timedelta(hours=30 + i)).isoformat(),
                "price_at_signal": 100.0,
                "price_1d_after": 101.0 if i % 2 == 0 else 99.0,
                "internal_score": 999,
            }
        )

    fake_boto3 = type(
        "FakeBoto3",
        (),
        {"resource": staticmethod(lambda *_a, **_k: _FakeDynamoResource(_FakeDynamoTable(items)))},
    )
    fake_botocore_exceptions = type("FakeBotocoreEx", (), {"ClientError": _FakeClientError})
    monkeypatch.setitem(__import__("sys").modules, "boto3", fake_boto3)
    monkeypatch.setitem(__import__("sys").modules, "botocore.exceptions", fake_botocore_exceptions)

    response = public_recent_signals_handler({}, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 10
    assert set(body[0].keys()) == {"symbol", "direction", "confidence", "timestamp_iso", "outcome"}
    assert body[0]["outcome"] in {"win", "loss", "neutral", "pending"}


def test_public_recent_signals_returns_empty_when_table_missing(monkeypatch) -> None:
    fake_boto3 = type(
        "FakeBoto3",
        (),
        {
            "resource": staticmethod(
                lambda *_a, **_k: _FakeDynamoResource(
                    _FakeDynamoTable([], raises=_FakeClientError("ResourceNotFoundException"))
                )
            )
        },
    )
    fake_botocore_exceptions = type("FakeBotocoreEx", (), {"ClientError": _FakeClientError})
    monkeypatch.setitem(__import__("sys").modules, "boto3", fake_boto3)
    monkeypatch.setitem(__import__("sys").modules, "botocore.exceptions", fake_botocore_exceptions)

    response = public_recent_signals_handler({}, {})
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == []


def test_public_performance_summary_aggregates_outcomes(monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    items = [
        {
            "symbol": "AAA",
            "direction": "long",
            "confidence": 84,
            "timestamp_iso": (now - timedelta(hours=30)).isoformat(),
            "price_at_signal": 100,
            "price_1d_after": 101,
        },
        {
            "symbol": "BBB",
            "direction": "short",
            "confidence": 79,
            "timestamp_iso": (now - timedelta(hours=30)).isoformat(),
            "price_at_signal": 100,
            "price_1d_after": 101,
        },
        {
            "symbol": "CCC",
            "direction": "long",
            "confidence": 52,
            "timestamp_iso": (now - timedelta(hours=30)).isoformat(),
            "price_at_signal": 100,
            "price_1d_after": 100.2,
        },
    ]
    fake_boto3 = type(
        "FakeBoto3",
        (),
        {"resource": staticmethod(lambda *_a, **_k: _FakeDynamoResource(_FakeDynamoTable(items)))},
    )
    fake_botocore_exceptions = type("FakeBotocoreEx", (), {"ClientError": _FakeClientError})
    monkeypatch.setitem(__import__("sys").modules, "boto3", fake_boto3)
    monkeypatch.setitem(__import__("sys").modules, "botocore.exceptions", fake_botocore_exceptions)

    response = public_performance_summary_handler({}, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_signals_tracked"] == 3
    assert body["total_resolved"] == 3
    assert body["win_count"] == 1
    assert body["loss_count"] == 1
    assert body["neutral_count"] == 1
    assert body["win_rate_percent"] == 33.3


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

