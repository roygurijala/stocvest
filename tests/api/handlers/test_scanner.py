from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from stocvest.api.services import scanner_response_cache
from stocvest.data.models import NewsArticle, Snapshot
from stocvest.data.polygon_client import PolygonError
from stocvest.api.handlers.scanner import (
    handler,
    scanner_briefing_handler,
    scanner_catalysts_handler,
    scanner_gap_intelligence_handler,
    scanner_gaps_handler,
    scanner_intraday_handler,
)


def test_handler_routes_eventbridge_schedule_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_scan(st: str, **kwargs: object) -> dict:
        return {
            "invocation": "schedule",
            "source": "eventbridge",
            "scan_type": st,
            "status": "completed",
            "setup_key": f"{st}#stub",
        }

    monkeypatch.setattr("stocvest.api.handlers.scanner.run_scheduled_scan_sync", _fake_scan)
    for scan_type in ("premarket", "intraday", "eod_summary"):
        response = handler({"source": "eventbridge", "scan_type": scan_type}, {})
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["invocation"] == "schedule"
        assert body["scan_type"] == scan_type
        assert body["status"] == "completed"


def test_handler_rejects_unknown_eventbridge_scan_type() -> None:
    response = handler({"source": "eventbridge", "scan_type": "overnight"}, {})
    assert response["statusCode"] == 400


def test_handler_routes_api_gateway_http_v2_route_key() -> None:
    event = {
        "version": "2.0",
        "routeKey": "POST /v1/scanner/gaps",
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "GAP1", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000}
                ],
                "limit": 5,
                "min_abs_gap_percent": 2.0,
            }
        ),
    }
    response = handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "GAP1"


def test_handler_unknown_route_returns_not_found() -> None:
    response = handler({"version": "2.0", "routeKey": "GET /v1/scanner/gaps", "body": "{}"}, {})
    assert response["statusCode"] == 404


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
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    start = datetime(2026, 4, 28, 9, 30, tzinfo=et)
    bars = []
    for i in range(15):
        close = 100.0 + ((i % 3) * 0.1)
        bars.append(_bar(start + timedelta(minutes=i), close=close, volume=350_000))
    bars.append(_bar(start + timedelta(minutes=15), close=100.2, volume=100_000))
    bars.append(_bar(start + timedelta(minutes=16), close=102.2, volume=400_000))

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
    response = scanner_intraday_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) >= 1
    assert body[0]["symbol"] == "GAP1"


def test_scanner_briefing_handler_returns_structured_morning_brief() -> None:
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
                    "economic_events": [
                        {"time": "08:30", "event_name": "CPI", "impact": "high"},
                    ],
                    "earnings_today": [
                        {"symbol": "GAP1", "company": "Gap One", "time": "AMC", "est_eps": 1.2},
                    ],
                    "gap_intelligence_items": [
                        {
                            "symbol": "GAP1",
                            "company_name": "Gap One Inc",
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
    response = scanner_briefing_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["date_iso"] == "2026-04-28"
    assert body.get("conditions", {}).get("label")
    assert body.get("top_watch", {}).get("symbol") == "GAP1"
    assert body.get("disclaimer")


def test_scanner_gap_intelligence_handler_merges_news(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()

    class _FakePoly:
        calls: list[tuple[str | None, int]] = []

        def __init__(self, api_key: str) -> None:
            _ = api_key

        async def __aenter__(self) -> "_FakePoly":
            return self

        async def __aexit__(self, *args: object) -> None:
            _ = args

        async def get_news(self, symbol=None, limit: int = 50):
            _FakePoly.calls.append((symbol, limit))
            return [
                NewsArticle(
                    article_id="n1",
                    published_at=datetime.now(timezone.utc),
                    title="GAP1 stock upgraded by analysts with higher price target",
                    description="",
                    url="https://example.com",
                    source="Reuters",
                    tickers=["GAP1"] if symbol is None else [symbol],
                    keywords=[],
                )
            ]

    _FakePoly.calls.clear()
    monkeypatch.setattr("stocvest.api.handlers.scanner.PolygonClient", _FakePoly)
    monkeypatch.setattr("stocvest.api.handlers.scanner.get_settings", lambda: SimpleNamespace(polygon_api_key="k"))

    event = {
        "body": json.dumps(
            {
                "snapshots": [
                    {
                        "symbol": "GAP1",
                        "prev_close": 100.0,
                        "last_trade_price": 110.0,
                        "day_volume": 900_000.0,
                        "prev_day_volume": 1_000_000.0,
                        "company_name": "Gap1 Co",
                    }
                ],
            }
        )
    }
    response = scanner_gap_intelligence_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"][0]["symbol"] == "GAP1"
    assert body["items"][0]["has_catalyst"] is True
    syms = [c[0] for c in _FakePoly.calls]
    assert None in syms
    assert "GAP1" in syms


def test_scanner_handlers_validate_inputs() -> None:
    response = scanner_gaps_handler({"body": json.dumps({"snapshots": {}})}, {})
    assert response["statusCode"] == 400


def test_scanner_gaps_handler_dynamic_empty_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()
    class _FakePoly:
        def __init__(self, api_key: str) -> None:
            _ = api_key

        async def __aenter__(self) -> "_FakePoly":
            return self

        async def __aexit__(self, *args: object) -> None:
            _ = args

        async def get_us_stocks_market_snapshots(self, *, include_otc: bool = False) -> list[Snapshot]:
            _ = include_otc
            return [
                Snapshot(
                    symbol="BIG",
                    prev_close=100.0,
                    last_trade_price=104.0,
                    day_volume=600_000.0,
                    prev_day_volume=2_000_000.0,
                ),
                Snapshot(
                    symbol="FLAT",
                    prev_close=50.0,
                    last_trade_price=50.2,
                    day_volume=600_000.0,
                    prev_day_volume=2_000_000.0,
                ),
            ]

        async def get_snapshots_many(self, symbols: list[str], chunk_size: int = 50) -> list[Snapshot]:
            _ = symbols
            _ = chunk_size
            return []

    monkeypatch.setattr("stocvest.api.handlers.scanner.PolygonClient", _FakePoly)
    monkeypatch.setattr("stocvest.api.handlers.scanner.get_settings", lambda: SimpleNamespace(polygon_api_key="k"))

    event = {
        "body": json.dumps({"snapshots": [], "limit": 5, "min_abs_gap_percent": 2.0, "min_day_volume": 0.0})
    }
    response = scanner_gaps_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "BIG"


def test_scanner_gaps_handler_dynamic_falls_back_on_polygon_403(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()
    class _FakePoly403:
        def __init__(self, api_key: str) -> None:
            _ = api_key

        async def __aenter__(self) -> "_FakePoly403":
            return self

        async def __aexit__(self, *args: object) -> None:
            _ = args

        async def get_us_stocks_market_snapshots(self, *, include_otc: bool = False) -> list[Snapshot]:
            _ = include_otc
            raise PolygonError("Polygon 403 on /v2/snapshot/locale/us/markets/stocks/tickers: denied")

        async def get_snapshots_many(self, symbols: list[str], chunk_size: int = 50) -> list[Snapshot]:
            _ = chunk_size
            assert "AAPL" in symbols
            return [
                Snapshot(
                    symbol="FALL1",
                    prev_close=50.0,
                    last_trade_price=52.0,
                    day_volume=600_000.0,
                    prev_day_volume=2_000_000.0,
                ),
            ]

    monkeypatch.setattr("stocvest.api.handlers.scanner.PolygonClient", _FakePoly403)
    monkeypatch.setattr("stocvest.api.handlers.scanner.get_settings", lambda: SimpleNamespace(polygon_api_key="k"))

    event = {"body": json.dumps({"snapshots": [], "limit": 10, "min_abs_gap_percent": 2.0})}
    response = scanner_gaps_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "FALL1"


def test_scanner_gaps_handler_uses_cache_within_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()
    calls = {"count": 0}

    class _FakeGapScanner:
        def __init__(self, min_abs_gap_percent: float, min_day_volume: float) -> None:
            _ = min_abs_gap_percent
            _ = min_day_volume

        def scan_snapshots(self, snapshots, limit: int):
            _ = snapshots
            _ = limit
            calls["count"] += 1
            return []

    monkeypatch.setattr("stocvest.api.handlers.scanner.PremarketGapScanner", _FakeGapScanner)

    event = {
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "GAP1", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000}
                ],
                "limit": 5,
                "min_abs_gap_percent": 2.0,
            }
        )
    }
    first = scanner_gaps_handler(event, {})
    second = scanner_gaps_handler(event, {})
    assert first["statusCode"] == 200
    assert second["statusCode"] == 200
    assert calls["count"] == 1


def test_scanner_gaps_cache_expires_after_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()
    calls = {"count": 0}
    fake_time = {"value": 1000.0}

    class _FakeGapScanner:
        def __init__(self, min_abs_gap_percent: float, min_day_volume: float) -> None:
            _ = min_abs_gap_percent
            _ = min_day_volume

        def scan_snapshots(self, snapshots, limit: int):
            _ = snapshots
            _ = limit
            calls["count"] += 1
            return []

    monkeypatch.setattr("stocvest.api.handlers.scanner.PremarketGapScanner", _FakeGapScanner)
    monkeypatch.setattr("stocvest.api.services.scanner_response_cache.time.time", lambda: fake_time["value"])

    event = {
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "GAP1", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000}
                ],
                "limit": 5,
                "min_abs_gap_percent": 2.0,
            }
        )
    }
    scanner_gaps_handler(event, {})
    scanner_gaps_handler(event, {})
    fake_time["value"] += 61.0
    scanner_gaps_handler(event, {})
    assert calls["count"] == 2


def test_scanner_cache_keys_are_payload_specific(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner_response_cache._MEMORY.clear()
    calls = {"count": 0}

    class _FakeGapScanner:
        def __init__(self, min_abs_gap_percent: float, min_day_volume: float) -> None:
            _ = min_abs_gap_percent
            _ = min_day_volume

        def scan_snapshots(self, snapshots, limit: int):
            _ = snapshots
            _ = limit
            calls["count"] += 1
            return []

    monkeypatch.setattr("stocvest.api.handlers.scanner.PremarketGapScanner", _FakeGapScanner)

    event_a = {
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "AAA", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000}
                ]
            }
        )
    }
    event_b = {
        "body": json.dumps(
            {
                "snapshots": [
                    {"symbol": "BBB", "prev_close": 100.0, "pre_market_price": 104.0, "day_volume": 12_000_000}
                ]
            }
        )
    }
    scanner_gaps_handler(event_a, {})
    scanner_gaps_handler(event_b, {})
    assert calls["count"] == 2


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

