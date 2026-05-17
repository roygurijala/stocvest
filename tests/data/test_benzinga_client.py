from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from stocvest.data import benzinga_client as bzc
from stocvest.data.benzinga_client import BenzingaArticle, BenzingaClient, BenzingaMultiResult


@pytest.fixture
def fake_settings(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    s = MagicMock()
    s.benzinga_news_api_key = "n"
    s.benzinga_api_key = ""
    s.benzinga_wim_key = "w"
    s.benzinga_analyst_key = "a"
    s.polygon_api_key = "p"
    monkeypatch.setattr(bzc, "get_settings", lambda: s)
    return s


@pytest.mark.asyncio
async def test_get_news_returns_articles(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bzc, "article_matches_ticker", lambda title, tickers, sym: True)
    fresh = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    sample = [
        {
            "id": "1",
            "title": "NVDA news",
            "body": "hello",
            "published_utc": fresh,
            "tickers": ["NVDA"],
            "channels": [],
        }
    ]

    async def fake_get_json(self: BenzingaClient, *, path: str, params: dict) -> object:
        assert path == "/v2/news"
        return sample

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_get_json)
    rows = await BenzingaClient().get_news("NVDA", hours=48, limit=5)
    assert len(rows) == 1
    assert rows[0].title.startswith("NVDA")


@pytest.mark.asyncio
async def test_get_news_for_symbol_panel_uses_date_window(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    fresh = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat().replace("+00:00", "Z")

    async def fake_get_json(self: BenzingaClient, *, path: str, params: dict) -> object:
        captured["path"] = path
        captured["params"] = dict(params)
        return [
            {
                "id": "99",
                "title": "Amazon expands same-day delivery",
                "body": "AMZN logistics",
                "published_utc": fresh,
                "tickers": ["AMZN"],
                "channels": [],
            }
        ]

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_get_json)
    rows = await BenzingaClient().get_news_for_symbol_panel("AMZN", days=20, limit=25)
    assert captured["path"] == "/v2/news"
    assert captured["params"]["tickers"] == "AMZN"
    assert captured["params"]["dateFrom"]
    assert captured["params"]["dateTo"]
    assert len(rows) == 1
    assert rows[0].tickers == ["AMZN"]


@pytest.mark.asyncio
async def test_get_news_fallback_polygon_when_benzinga_empty(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bzc, "article_matches_ticker", lambda *a: True)

    async def empty(self: BenzingaClient, symbol: str, hours: int = 8, limit: int = 10) -> list:
        del symbol, hours, limit
        return []

    monkeypatch.setattr(BenzingaClient, "get_news", empty)

    fake_poly_news = [{"id": "p1", "title": "Via Polygon", "description": "", "published_utc": "2026-01-01T00:00:00Z"}]

    class FakePoly:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> FakePoly:
            return self

        async def __aexit__(self, *exc: object) -> None:
            pass

        async def get_market_news(self, **kwargs: object) -> list:
            return fake_poly_news

    monkeypatch.setattr(bzc, "PolygonClient", FakePoly)
    rows = await BenzingaClient().get_news_with_fallback("NVDA", mode="day")
    assert any(r.source == "polygon" for r in rows)


@pytest.mark.asyncio
async def test_decay_day_extended_window_weights_old_article(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 1, 2, 18, tzinfo=timezone.utc)
    old_pub = datetime(2025, 12, 31, 10, tzinfo=timezone.utc)

    inner = BenzingaArticle(
        article_id="z",
        title="Old",
        body=None,
        published_at=old_pub,
        tickers=["X"],
        channels=[],
    )

    calls: dict[str, int] = {}

    async def fake_get_news(self: BenzingaClient, symbol: str, hours: int, limit: int) -> list:
        calls["hours"] = hours
        del symbol, limit
        if hours <= 8:
            return []
        return [inner]

    monkeypatch.setattr(BenzingaClient, "get_news", fake_get_news)

    fake_dt = MagicMock()

    fake_dt.now = MagicMock(side_effect=lambda tz=None: now)
    monkeypatch.setattr(bzc, "datetime", fake_dt)

    weighted = await BenzingaClient().get_news_with_fallback("X", mode="day")

    assert calls.get("hours", 0) >= 48
    assert weighted and getattr(weighted[0], "weight") == pytest.approx(0.40)


@pytest.mark.asyncio
async def test_get_why_is_it_moving_direction(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    blob = [
        {"title": "NVDA moving lower on profit taking", "body": "Selling pressure mounts.", "published_utc": "2026-01-02T14:00:00Z"}
    ]

    async def fake_get_json(self: BenzingaClient, *, path: str, params: dict) -> object:
        return blob

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_get_json)
    row = await BenzingaClient().get_why_is_it_moving("NVDA")
    assert row is not None
    assert row.direction == "down"


@pytest.mark.asyncio
async def test_rating_upgrade_mapped(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    api = [
        {"ticker": "AAPL", "action_company": "Upgrades", "rating_current": "Buy", "pt_current": "200", "analyst": "MS", "date": "2026-01-01"}
    ]

    async def fake_get_json(self: BenzingaClient, *, path: str, params: dict) -> object:
        return api

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_get_json)
    rows = await BenzingaClient().get_analyst_ratings("AAPL")
    assert rows and rows[0].action == "Upgrade"
    assert rows[0].price_target == 200.0


@pytest.mark.asyncio
async def test_earnings_beat_and_miss(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_win(self: BenzingaClient, *, path: str, params: dict) -> object:
        if "earnings" in path:
            return [{"ticker": "AAPL", "eps": "1.2", "eps_est": "1.05", "fiscal_period": "Q1", "date": "2026-01-01"}]
        return []

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_win)
    hi = await BenzingaClient().get_earnings_results("AAPL")
    assert hi[0].beat is True
    assert hi[0].eps_surprise_pct == pytest.approx(14.3, rel=1e-2)

    async def fake_lose(self: BenzingaClient, *, path: str, params: dict) -> object:
        return [{"ticker": "AAPL", "eps": "0.95", "eps_est": "1.10", "fiscal_period": "Q1", "date": "2026-01-01"}]

    monkeypatch.setattr(BenzingaClient, "_get_json", fake_lose)
    lo = await BenzingaClient().get_earnings_results("AAPL")
    assert lo[0].beat is False


@pytest.mark.asyncio
async def test_get_multi_wrapsFailures(fake_settings: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    async def ok_news(self: BenzingaClient, symbol: str, mode: str = "day") -> list:
        return [
            BenzingaArticle(
                article_id="1",
                title="t",
                body=None,
                published_at=datetime.now(timezone.utc),
                tickers=[symbol.upper()],
                channels=[],
            )
        ]

    async def fail(self: BenzingaClient, *args: object, **kwargs: object) -> None:
        raise RuntimeError("x")

    monkeypatch.setattr(BenzingaClient, "get_news_with_fallback", ok_news)
    monkeypatch.setattr(BenzingaClient, "get_why_is_it_moving", fail)
    monkeypatch.setattr(BenzingaClient, "get_analyst_ratings", fail)
    monkeypatch.setattr(BenzingaClient, "get_corporate_guidance", fail)
    monkeypatch.setattr(BenzingaClient, "get_earnings_results", fail)

    res = await BenzingaClient().get_multi("AAPL")
    assert len(res.news) == 1
    assert isinstance(res, BenzingaMultiResult)
