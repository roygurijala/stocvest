from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from stocvest.api.handlers.market_data import (
    bars_handler,
    market_status_handler,
    news_handler,
    snapshot_handler,
)
from stocvest.data.models import Bar, MarketStatus, NewsArticle, Snapshot, Timeframe
from stocvest.utils.config import get_settings


class _FakePolygonClient:
    last_init_api_key: str | None = None

    def __init__(self, api_key: str) -> None:
        self.__class__.last_init_api_key = api_key

    async def __aenter__(self) -> "_FakePolygonClient":
        return self

    async def __aexit__(self, *_) -> None:
        return None

    async def get_market_status(self) -> MarketStatus:
        return MarketStatus(
            market="stocks",
            server_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
            exchanges={"nyse": "open"},
            currencies={},
        )

    async def get_snapshot(self, symbol: str) -> Snapshot:
        return Snapshot(symbol=symbol, last_trade_price=101.5, day_volume=1_000_000)

    async def get_bars(
        self,
        symbol: str,
        timeframe: Timeframe,
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 200,
        adjusted: bool = True,
    ) -> list[Bar]:
        _ = from_date
        _ = to_date
        _ = adjusted
        return [
            Bar(
                symbol=symbol,
                timestamp=datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc),
                timeframe=timeframe,
                open=100,
                high=102,
                low=99,
                close=101,
                volume=float(limit),
            )
        ]

    async def get_news(self, symbol: str | None = None, limit: int = 20, order: str = "desc") -> list[NewsArticle]:
        _ = order
        return [
            NewsArticle(
                article_id="a1",
                published_at=datetime(2026, 1, 2, 13, 0, tzinfo=timezone.utc),
                title=f"Headline {symbol or 'MARKET'}",
                url="https://example.com/news/1",
                tickers=[symbol] if symbol else [],
                keywords=[],
            )
            for _ in range(min(limit, 1))
        ]


@pytest.fixture(autouse=True)
def _clear_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "poly-test-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_market_status_handler_returns_payload() -> None:
    response = market_status_handler({}, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["market"] == "stocks"
    assert _FakePolygonClient.last_init_api_key == "poly-test-key"


def test_snapshot_handler_requires_symbol() -> None:
    response = snapshot_handler({"queryStringParameters": {}}, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_snapshot_handler_returns_symbol_snapshot() -> None:
    event = {"queryStringParameters": {"symbol": "aapl"}}
    response = snapshot_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["symbol"] == "AAPL"
    assert body["last_trade_price"] == 101.5


def test_bars_handler_validates_timeframe() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "timeframe": "2min"}}
    response = bars_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_bars_handler_returns_bar_series() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "timeframe": "1day", "limit": "5"}}
    response = bars_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["symbol"] == "AAPL"
    assert body[0]["timeframe"] == "1day"
    assert body[0]["volume"] == 5.0


def test_news_handler_returns_filtered_news() -> None:
    event = {"queryStringParameters": {"symbol": "msft", "limit": "1"}}
    response = news_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["title"] == "Headline MSFT"

