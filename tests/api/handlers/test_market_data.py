from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from stocvest.api.handlers.market_data import (
    bars_batch_handler,
    bars_handler,
    dashboard_summary_handler,
    earnings_calendar_handler,
    market_status_handler,
    news_handler,
    options_chain_handler,
    snapshot_handler,
    snapshots_batch_handler,
    symbol_names_handler,
    tickers_search_handler,
    vix_snapshot_handler,
)
from stocvest.data.models import Bar, EarningsEvent, MarketStatus, NewsArticle, OptionContract, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonError
from stocvest.utils.config import get_settings


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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

    async def search_reference_tickers(self, query: str, *, limit: int = 15) -> list[dict[str, str]]:
        _ = limit
        q = query.strip().lower()
        if "booz" in q:
            return [{"ticker": "BAH", "name": "Booz Allen Hamilton Holding Corporation"}]
        if q.startswith("msft") or q == "micro":
            return [{"ticker": "MSFT", "name": "Microsoft Corporation"}]
        return []

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
        now = datetime.now(timezone.utc)
        return [
            {
                "id": "a1",
                "published_utc": _iso_utc(now - timedelta(hours=2)),
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


def test_dashboard_summary_handler_returns_aggregate_payload() -> None:
    event = {
        "queryStringParameters": {
            "earnings_symbols": "AAPL,MSFT",
            "earnings_days": "7",
            "sparkline_limit": "12",
            "daily_limit": "8",
        }
    }
    response = dashboard_summary_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"]["market"] == "stocks"
    assert isinstance(body["snapshots"], list) and len(body["snapshots"]) >= 1
    assert isinstance(body["daily_closes"], dict)
    assert "SPY" in body["daily_closes"] or "QQQ" in body["daily_closes"]
    assert body["earnings"]["symbols"] == ["AAPL", "MSFT"]
    assert isinstance(body["earnings"]["upcoming"], list)


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


def test_vix_snapshot_handler_returns_usable_snapshot() -> None:
    class _VixClient(_FakePolygonClient):
        async def get_indices_snapshots(self, tickers: list[str]) -> dict[str, Snapshot]:
            _ = tickers
            return {
                "I:VIX": Snapshot(
                    symbol="I:VIX",
                    last_trade_price=18.5,
                    change_percent=0.4,
                    prev_close=18.0,
                )
            }

    response = vix_snapshot_handler({}, {}, client_factory=_VixClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["snapshot"]["symbol"] == "I:VIX"
    assert body["snapshot"]["last_trade_price"] == 18.5


def test_tickers_search_handler_requires_query() -> None:
    response = tickers_search_handler({"queryStringParameters": {"q": ""}}, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_tickers_search_handler_accepts_single_char() -> None:
    class _SingleCharFake(_FakePolygonClient):
        async def search_reference_tickers(self, query: str, *, limit: int = 15) -> list[dict[str, str]]:
            _ = limit
            if query.strip().upper() == "F":
                return [{"ticker": "F", "name": "Ford Motor Company"}]
            return await super().search_reference_tickers(query, limit=limit)

    response = tickers_search_handler({"queryStringParameters": {"q": "F"}}, {}, client_factory=_SingleCharFake)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [{"symbol": "F", "name": "Ford Motor Company"}]


def test_tickers_search_handler_returns_items() -> None:
    event = {"queryStringParameters": {"q": "Booz"}}
    response = tickers_search_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [{"symbol": "BAH", "name": "Booz Allen Hamilton Holding Corporation"}]


class _RefNamesClient(_FakePolygonClient):
    async def get_ticker_details(self, symbol: str) -> dict:
        catalog = {
            "AAPL": {"ticker": "AAPL", "name": "Apple Inc.", "active": True},
            "MSFT": {"ticker": "MSFT", "name": "Microsoft Corporation", "active": True},
        }
        return catalog.get(symbol.strip().upper(), {})


def test_symbol_names_handler_requires_symbols() -> None:
    response = symbol_names_handler({"queryStringParameters": {}}, {}, client_factory=_RefNamesClient)
    assert response["statusCode"] == 400


def test_symbol_names_handler_maps_known_tickers() -> None:
    event = {"queryStringParameters": {"symbols": "aapl,msft,zzzz"}}
    response = symbol_names_handler(event, {}, client_factory=_RefNamesClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["names"]["AAPL"] == "Apple Inc."
    assert body["names"]["MSFT"] == "Microsoft Corporation"
    # Unknown ticker resolves to nothing and is simply omitted.
    assert "ZZZZ" not in body["names"]


def test_symbol_names_handler_ignores_malformed_tokens() -> None:
    event = {"queryStringParameters": {"symbols": "aapl, , 123, !!"}}
    response = symbol_names_handler(event, {}, client_factory=_RefNamesClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["names"] == {"AAPL": "Apple Inc."}


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
    assert "articles" in body
    assert body["symbol"] == "MSFT"
    assert len(body["articles"]) == 1
    assert body["articles"][0]["title"] == "Headline MSFT"
    assert body["articles"][0]["sentiment_label"] == "bullish"
    assert body["total_found"] >= 1


class _DiversityPolygonClient(_FakePolygonClient):
    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        _ = tickers
        _ = limit
        _ = order
        _ = published_utc_gte
        return [
            {"id": "r1", "published_utc": "2026-01-02T13:05:00Z", "title": "R one", "description": "x", "article_url": "https://e/r1", "publisher": {"name": "Reuters"}, "tickers": ["AAPL"], "insights": [{"sentiment": "positive"}]},
            {"id": "r2", "published_utc": "2026-01-02T13:04:00Z", "title": "R two", "description": "x", "article_url": "https://e/r2", "publisher": {"name": "Reuters"}, "tickers": ["MSFT"], "insights": [{"sentiment": "positive"}]},
            {"id": "r3", "published_utc": "2026-01-02T13:03:00Z", "title": "R three", "description": "x", "article_url": "https://e/r3", "publisher": {"name": "Reuters"}, "tickers": ["NVDA"], "insights": [{"sentiment": "positive"}]},
            {"id": "b1", "published_utc": "2026-01-02T13:02:00Z", "title": "B one", "description": "x", "article_url": "https://e/b1", "publisher": {"name": "Bloomberg"}, "tickers": ["TSLA"], "insights": [{"sentiment": "neutral"}]},
            {"id": "c1", "published_utc": "2026-01-02T13:01:00Z", "title": "C one", "description": "x", "article_url": "https://e/c1", "publisher": {"name": "CNBC"}, "tickers": ["AMZN"], "insights": [{"sentiment": "negative"}]},
        ]


def test_news_handler_applies_publisher_diversity_cap() -> None:
    """The market-wide (no-symbol) tape spreads across publishers: it prefers one
    headline per source and never lets a single outlet exceed two, so no publisher
    dominates the brief even when it has the most candidates."""
    event = {"queryStringParameters": {"limit": "8"}}
    response = news_handler(event, {}, client_factory=_DiversityPolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    pubs = [h["publisher"]["name"] for h in body["headlines"]]
    # All three distinct publishers represented; Reuters (3 candidates) capped at 2.
    assert set(pubs) == {"Reuters", "Bloomberg", "CNBC"}
    assert max(pubs.count(p) for p in set(pubs)) <= 2
    assert pubs.count("Reuters") == 2


class _RankNewsClient(_FakePolygonClient):
    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        _ = tickers
        _ = limit
        _ = order
        _ = published_utc_gte
        ts = "2026-05-04T18:00:00Z"
        return [
            {
                "id": "g1",
                "published_utc": ts,
                "title": "MSFT stock moves in Tuesday session",
                "description": "Trading desk notes",
                "article_url": "https://e/g1",
                "publisher": {"name": "Reuters"},
                "tickers": ["MSFT"],
                "insights": [{"sentiment": "neutral"}],
            },
            {
                "id": "e1",
                "published_utc": ts,
                "title": "MSFT Q2 earnings beat revenue expectations",
                "description": "Cloud strength",
                "article_url": "https://e/e1",
                "publisher": {"name": "Reuters"},
                "tickers": ["MSFT"],
                "insights": [{"sentiment": "positive"}],
            },
        ]


def test_news_handler_ranks_catalyst_above_generic() -> None:
    event = {"queryStringParameters": {"limit": "10"}}
    response = news_handler(event, {}, client_factory=_RankNewsClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["headlines"][0]["title"].startswith("MSFT Q2 earnings")
    assert body["headlines"][0]["catalyst_category"] == "earnings"
    assert body["headlines"][0]["credibility"]["band"] == "elite"


def test_news_handler_includes_relevance_enrichment() -> None:
    event = {"queryStringParameters": {"symbol": "msft", "limit": "5"}}
    response = news_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    h = body["articles"][0]
    assert "sentiment_score" in h
    assert "source" in h and h["source"] == "polygon"
    assert "source_label" in h
    assert "age_label" in h
    assert "is_recent" in h


class _SymbolScopeNewsClient(_FakePolygonClient):
    """Simulates a leaky upstream: returns multiple tickers even when scoped."""

    last_news_tickers: list[str] | None = None

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
        self.__class__.last_news_tickers = list(tickers) if tickers else None
        now = datetime.now(timezone.utc)
        return [
            {
                "id": "coty1",
                "published_utc": _iso_utc(now - timedelta(hours=5)),
                "title": "COTY quarterly revenue tops estimates",
                "description": "earnings beat beauty segment",
                "article_url": "https://e/coty",
                "publisher": {"name": "Reuters"},
                "tickers": ["COTY"],
                "insights": [{"sentiment": "positive"}],
            },
            {
                "id": "pins1",
                "published_utc": _iso_utc(now - timedelta(hours=4)),
                "title": "PINS user engagement trends",
                "description": "Pinterest session data",
                "article_url": "https://e/pins",
                "publisher": {"name": "Reuters"},
                "tickers": ["PINS"],
                "insights": [{"sentiment": "neutral"}],
            },
        ]


def test_news_handler_symbol_query_only_fetches_and_returns_that_ticker() -> None:
    event = {"queryStringParameters": {"symbol": "PINS", "limit": "10"}}
    response = news_handler(event, {}, client_factory=_SymbolScopeNewsClient)
    assert response["statusCode"] == 200
    assert _SymbolScopeNewsClient.last_news_tickers == ["PINS"]
    body = json.loads(response["body"])
    ids = {h["id"] for h in body["articles"]}
    assert ids == {"pins1"}


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


def test_earnings_calendar_handler_market_scope_returns_full_calendar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "test-finnhub")
    get_settings.cache_clear()

    import httpx
    import respx

    report_day = (date.today() + timedelta(days=2)).isoformat()

    with respx.mock:
        respx.get("https://finnhub.io/api/v1/calendar/earnings").mock(
            return_value=httpx.Response(
                200,
                json={
                    "earningsCalendar": [
                        {"date": report_day, "symbol": "CRWD", "hour": "amc"},
                        {"date": report_day, "symbol": "AVGO", "hour": "amc"},
                    ]
                },
            )
        )
        event = {"queryStringParameters": {"scope": "market", "days": "7"}}
        response = earnings_calendar_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body.get("scope") == "market"
    syms = {row["symbol"] for row in body["upcoming"]}
    assert "CRWD" in syms and "AVGO" in syms


def test_earnings_calendar_handler_returns_upcoming_and_recent() -> None:
    event = {"queryStringParameters": {"symbols": "aapl,msft", "days": "7"}}
    response = earnings_calendar_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["symbols"] == ["AAPL", "MSFT"]
    assert isinstance(body["upcoming"], list)
    assert isinstance(body["recent"], list)
    assert body.get("source") in ("polygon", "finnhub", "benzinga", "fmp", "empty", None)


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


def test_news_symbol_panel_rejects_days_over_20() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "days": "25"}}
    response = news_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_news_symbol_panel_rejects_recent_hours_out_of_range() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "recent_hours": "200"}}
    response = news_handler(event, {}, client_factory=_FakePolygonClient)
    assert response["statusCode"] == 400


def test_news_symbol_panel_returns_requested_recent_cutoff_hours() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "limit": "5", "recent_hours": "12"}}
    response = news_handler(event, {}, client_factory=_make_has_recent_news_client(True))
    body = json.loads(response["body"])
    assert body["recent_cutoff_hours"] == 12


def test_news_symbol_panel_swing_trading_mode_defaults_recent_hours_to_120() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "trading_mode": "swing"}}
    response = news_handler(event, {}, client_factory=_make_has_recent_news_client(True))
    body = json.loads(response["body"])
    assert body["recent_cutoff_hours"] == 120


def _make_has_recent_news_client(recent: bool):
    class _HasRecentNewsClient(_FakePolygonClient):
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
            sym = str(tickers[0]).upper() if tickers else "SPY"
            now = datetime.now(timezone.utc)
            pub = now - timedelta(hours=2) if recent else now - timedelta(hours=12)
            return [
                {
                    "id": "n1",
                    "published_utc": _iso_utc(pub),
                    "title": f"Story {sym}",
                    "description": "d",
                    "article_url": "https://example.com/x",
                    "publisher": {"name": "Reuters"},
                    "tickers": [sym],
                    "insights": [{"sentiment": "neutral"}],
                }
            ]

    return _HasRecentNewsClient


def test_news_endpoint_returns_has_recent_flag_true() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "limit": "5"}}
    response = news_handler(event, {}, client_factory=_make_has_recent_news_client(True))
    body = json.loads(response["body"])
    assert body["has_recent_news"] is True


def test_news_endpoint_returns_has_recent_flag_false() -> None:
    event = {"queryStringParameters": {"symbol": "AAPL", "limit": "5"}}
    response = news_handler(event, {}, client_factory=_make_has_recent_news_client(False))
    body = json.loads(response["body"])
    assert body["has_recent_news"] is False


class _TwentyDayWindowClient(_FakePolygonClient):
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
        sym = str(tickers[0]).upper() if tickers else "SPY"
        now = datetime.now(timezone.utc)
        return [
            {
                "id": "too_old",
                "published_utc": _iso_utc(now - timedelta(days=25)),
                "title": "Old",
                "description": "d",
                "article_url": "https://example.com/old",
                "publisher": {"name": "Reuters"},
                "tickers": [sym],
                "insights": [{"sentiment": "neutral"}],
            },
            {
                "id": "in_window",
                "published_utc": _iso_utc(now - timedelta(days=5)),
                "title": "Recent window",
                "description": "d",
                "article_url": "https://example.com/new",
                "publisher": {"name": "Bloomberg"},
                "tickers": [sym],
                "insights": [{"sentiment": "positive"}],
            },
        ]


def test_news_endpoint_20_day_limit() -> None:
    event = {"queryStringParameters": {"symbol": "NVDA", "days": "20", "limit": "10"}}
    response = news_handler(event, {}, client_factory=_TwentyDayWindowClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    ids = {a["id"] for a in body["articles"]}
    assert ids == {"in_window"}
    assert body["total_found"] == 1


class _EmptyNewsClient(_FakePolygonClient):
    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        _ = tickers
        _ = limit
        _ = order
        _ = published_utc_gte
        return []


def test_news_endpoint_empty_result() -> None:
    event = {"queryStringParameters": {"symbol": "ZZZ", "days": "20"}}
    response = news_handler(event, {}, client_factory=_EmptyNewsClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["articles"] == []
    assert body["has_recent_news"] is False
    assert body["total_found"] == 0
    assert body["analyst"]["feed_state"] in ("empty", "unconfigured")


def test_news_symbol_panel_includes_analyst_ratings(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)

    async def _fake_ratings(self, symbol: str, days: int = 30):  # noqa: ARG001
        return [
            __import__("stocvest.data.benzinga_client", fromlist=["BenzingaRating"]).BenzingaRating(
                symbol.upper(),
                "Upgrade",
                "Buy",
                120.0,
                "Goldman Sachs",
                now - timedelta(days=1),
            )
        ]

    monkeypatch.setattr(
        "stocvest.api.handlers.market_data.BenzingaClient.get_analyst_ratings",
        _fake_ratings,
    )
    monkeypatch.setattr(get_settings(), "benzinga_analyst_key", "test-key")

    event = {"queryStringParameters": {"symbol": "AAPL", "limit": "5"}}
    response = news_handler(event, {}, client_factory=_make_has_recent_news_client(True))
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["analyst"]["feed_state"] == "available"
    assert len(body["analyst"]["ratings"]) == 1
    assert body["analyst"]["ratings"][0]["firm"] == "Goldman Sachs"
    assert body["analyst"]["ratings"][0]["action"] == "Upgrade"

