from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from stocvest.api.handlers.market_data import (
    bars_batch_handler,
    bars_handler,
    earnings_calendar_handler,
    market_status_handler,
    news_handler,
    options_chain_handler,
    snapshot_handler,
    snapshots_batch_handler,
)
from stocvest.data.models import Bar, EarningsEvent, MarketStatus, NewsArticle, OptionContract, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonError
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

    async def get_snapshots_many(self, symbols: list[str], *, chunk_size: int = 50) -> list[Snapshot]:
        _ = chunk_size
        return [await self.get_snapshot(s) for s in symbols]

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

    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        _ = limit
        _ = order
        _ = published_utc_gte
        sym = "SPY"
        if tickers:
            for candidate in tickers:
                up = str(candidate).upper()
                if up == "MSFT":
                    sym = "MSFT"
                    break
            else:
                sym = str(tickers[0]).upper()
        return [
            {
                "id": "a1",
                "published_utc": "2026-01-02T13:00:00Z",
                "title": f"Headline {sym}",
                "description": "Market moving update",
                "article_url": "https://example.com/news/1",
                "publisher": {"name": "Reuters"},
                "tickers": [sym],
                "insights": [{"sentiment": "positive"}],
            }
        ]

    async def get_options_chain(
        self,
        underlying: str,
        expiration_date: str | None = None,
        strike_price_gte: float | None = None,
        strike_price_lte: float | None = None,
        option_type: str | None = None,
        limit: int = 100,
    ) -> list[OptionContract]:
        _ = expiration_date
        _ = strike_price_gte
        _ = strike_price_lte
        _ = option_type
        _ = limit
        return [
            OptionContract(
                symbol=f"O:{underlying}260620C00100000",
                underlying=underlying,
                expiration=datetime(2026, 6, 20, tzinfo=timezone.utc),
                strike=100.0,
                option_type="call",
                last_price=2.5,
                bid=2.4,
                ask=2.6,
                volume=1200,
                open_interest=4500,
                implied_volatility=0.28,
                delta=0.52,
                gamma=0.03,
                theta=-0.02,
                vega=0.11,
            )
        ]

    async def get_earnings_calendar(self, symbols: list[str], from_date: str, to_date: str) -> list[EarningsEvent]:
        _ = from_date
        _ = to_date
        return [
            EarningsEvent(
                symbol=symbol,
                company_name=f"{symbol} Inc",
                report_date=datetime(2026, 1, 3, tzinfo=timezone.utc).date(),
                report_time="before_market",
                estimated_eps=1.2,
                actual_eps=1.3,
                surprise_percent=8.3,
                market_cap=2_000_000_000_000,
            )
            for symbol in symbols[:2]
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


def test_snapshots_batch_handler_requires_symbols() -> None:
    response = snapshots_batch_handler({"queryStringParameters": {}}, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_snapshots_batch_handler_returns_snapshots() -> None:
    event = {"queryStringParameters": {"symbols": "aapl,msft"}}
    response = snapshots_batch_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["snapshots"]) == 2
    syms = {s["symbol"] for s in body["snapshots"]}
    assert syms == {"AAPL", "MSFT"}


def test_bars_batch_handler_returns_bars_by_symbol() -> None:
    event = {
        "body": json.dumps(
            {"requests": [{"symbol": "AAPL", "timeframe": "1min", "limit": 3}, {"symbol": "MSFT", "timeframe": "5min", "limit": 2}]}
        )
    }
    response = bars_batch_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert set(body["bars_by_symbol"].keys()) == {"AAPL", "MSFT"}
    assert body["bars_by_symbol"]["AAPL"][0]["timeframe"] == "1min"
    assert body["bars_by_symbol"]["MSFT"][0]["timeframe"] == "5min"


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
    assert "headlines" in body
    assert len(body["headlines"]) == 1
    assert body["headlines"][0]["title"] == "Headline MSFT"
    assert body["headlines"][0]["publisher"]["tier"] == 1
    assert body["headlines"][0]["affected_stocks"][0]["symbol"] == "MSFT"


def test_options_chain_handler_returns_contracts_with_greeks() -> None:
    event = {"queryStringParameters": {"symbol": "aapl", "limit": "10"}}
    response = options_chain_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) == 1
    assert body[0]["underlying"] == "AAPL"
    assert body[0]["delta"] == 0.52
    assert body[0]["gamma"] == 0.03
    assert body[0]["theta"] == -0.02
    assert body[0]["vega"] == 0.11


def test_earnings_calendar_handler_returns_upcoming_and_recent() -> None:
    event = {"queryStringParameters": {"symbols": "aapl,msft", "days": "7"}}
    response = earnings_calendar_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["symbols"] == ["AAPL", "MSFT"]
    assert isinstance(body["upcoming"], list)
    assert isinstance(body["recent"], list)


class _ForbiddenPolygonClient:
    def __init__(self, api_key: str) -> None:
        _ = api_key

    async def __aenter__(self) -> "_ForbiddenPolygonClient":
        return self

    async def __aexit__(self, *_) -> None:
        return None

    async def get_earnings_calendar(self, symbols: list[str], from_date: str, to_date: str) -> list[EarningsEvent]:
        _ = symbols
        _ = from_date
        _ = to_date
        raise PolygonError("Polygon 403 on /benzinga/v1/earnings: forbidden")


def test_earnings_calendar_handler_returns_notice_on_polygon_forbidden() -> None:
    event = {"queryStringParameters": {"symbols": "aapl", "days": "7"}}
    response = earnings_calendar_handler(event, {}, client_factory=_ForbiddenPolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["upcoming"] == []
    assert body["recent"] == []
    assert isinstance(body.get("notice"), str)
    assert "polygon" in body["notice"].lower()

