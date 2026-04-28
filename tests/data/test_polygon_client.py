"""
Polygon client tests — all HTTP calls are mocked with respx.

No real API key or network needed.  Marked pytest.mark.unit.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone, date

import pytest
import respx
import httpx

from stocvest.data.models import Timeframe, Bar, Snapshot, NewsArticle, OptionContract
from stocvest.data.polygon_client import PolygonClient, PolygonError

FAKE_KEY = "test_api_key_12345"


@pytest.fixture
def base_url():
    return "https://api.polygon.io"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def agg_bar(t_ms: int, o=100, h=102, l=98, c=101, v=1_000_000, vw=100.5, n=500) -> dict:
    return {"t": t_ms, "o": o, "h": h, "l": l, "c": c, "v": v, "vw": vw, "n": n}


# ──────────────────────────────────────────────────────────────────────────────
# get_bars
# ──────────────────────────────────────────────────────────────────────────────

class TestGetBars:
    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_bars(self):
        t = 1704182400000  # some ms timestamp
        respx.get(
            "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/minute/2000-01-01/2024-01-02"
        ).mock(return_value=httpx.Response(200, json={
            "status": "OK",
            "results": [agg_bar(t), agg_bar(t + 60_000)],
        }))

        async with PolygonClient(FAKE_KEY) as client:
            bars = await client.get_bars("AAPL", Timeframe.MIN_1, to_date="2024-01-02")

        assert len(bars) == 2
        assert isinstance(bars[0], Bar)
        assert bars[0].symbol == "AAPL"
        assert bars[0].open   == 100
        assert bars[0].close  == 101
        assert bars[0].vwap   == 100.5

    @pytest.mark.asyncio
    @respx.mock
    async def test_empty_results(self):
        respx.get(
            "https://api.polygon.io/v2/aggs/ticker/FAKE/range/1/day/2000-01-01/2024-01-02"
        ).mock(return_value=httpx.Response(200, json={"status": "OK", "results": []}))

        async with PolygonClient(FAKE_KEY) as client:
            bars = await client.get_bars("FAKE", Timeframe.DAY_1, to_date="2024-01-02")

        assert bars == []

    @pytest.mark.asyncio
    @respx.mock
    async def test_non_200_raises(self):
        respx.get(
            "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2000-01-01/2024-01-02"
        ).mock(return_value=httpx.Response(403, text="Forbidden"))

        with pytest.raises(PolygonError, match="403"):
            async with PolygonClient(FAKE_KEY) as client:
                await client.get_bars("AAPL", Timeframe.DAY_1, to_date="2024-01-02")

    @pytest.mark.asyncio
    @respx.mock
    async def test_bar_timestamps_are_utc(self):
        t = 1704182400000
        respx.get(
            "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2000-01-01/2024-01-02"
        ).mock(return_value=httpx.Response(200, json={
            "status": "OK",
            "results": [agg_bar(t)],
        }))

        async with PolygonClient(FAKE_KEY) as client:
            bars = await client.get_bars("AAPL", Timeframe.DAY_1, to_date="2024-01-02")

        assert bars[0].timestamp.tzinfo is not None


# ──────────────────────────────────────────────────────────────────────────────
# get_snapshot
# ──────────────────────────────────────────────────────────────────────────────

SNAPSHOT_PAYLOAD = {
    "status": "OK",
    "ticker": {
        "ticker": "AAPL",
        "day":      {"o": 185.0, "h": 188.0, "l": 183.0, "c": 187.0, "v": 50_000_000, "vw": 186.0},
        "prevDay":  {"c": 183.0},
        "lastTrade": {"p": 187.0, "s": 100},
        "lastQuote": {"P": 187.0, "p": 187.02},
        "market": "open",
    }
}

class TestGetSnapshot:
    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_snapshot(self):
        respx.get(
            "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/AAPL"
        ).mock(return_value=httpx.Response(200, json=SNAPSHOT_PAYLOAD))

        async with PolygonClient(FAKE_KEY) as client:
            snap = await client.get_snapshot("AAPL")

        assert isinstance(snap, Snapshot)
        assert snap.symbol        == "AAPL"
        assert snap.day_open      == 185.0
        assert snap.prev_close    == 183.0
        assert snap.market_status == "open"

    @pytest.mark.asyncio
    @respx.mock
    async def test_change_percent_calculated(self):
        respx.get(
            "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/AAPL"
        ).mock(return_value=httpx.Response(200, json=SNAPSHOT_PAYLOAD))

        async with PolygonClient(FAKE_KEY) as client:
            snap = await client.get_snapshot("AAPL")

        # last_price=187, prev_close=183 → change% = (4/183)*100 ≈ 2.19%
        assert snap.change_percent is not None
        assert snap.change_percent == pytest.approx(2.186, rel=0.01)


# ──────────────────────────────────────────────────────────────────────────────
# get_news
# ──────────────────────────────────────────────────────────────────────────────

NEWS_PAYLOAD = {
    "status": "OK",
    "results": [
        {
            "id": "abc123",
            "published_utc": "2024-01-02T14:30:00Z",
            "title": "Apple reports record earnings",
            "description": "AAPL beats estimates",
            "article_url": "https://example.com/article",
            "publisher": {"name": "Reuters"},
            "tickers": ["AAPL"],
            "keywords": ["earnings", "tech"],
        }
    ]
}

class TestGetNews:
    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_articles(self):
        respx.get("https://api.polygon.io/v2/reference/news").mock(
            return_value=httpx.Response(200, json=NEWS_PAYLOAD)
        )

        async with PolygonClient(FAKE_KEY) as client:
            articles = await client.get_news("AAPL")

        assert len(articles) == 1
        a = articles[0]
        assert isinstance(a, NewsArticle)
        assert a.article_id == "abc123"
        assert a.title      == "Apple reports record earnings"
        assert "AAPL" in a.tickers
        assert a.sentiment is None  # not set until Phase 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_empty_news(self):
        respx.get("https://api.polygon.io/v2/reference/news").mock(
            return_value=httpx.Response(200, json={"status": "OK", "results": []})
        )

        async with PolygonClient(FAKE_KEY) as client:
            articles = await client.get_news()

        assert articles == []


# ──────────────────────────────────────────────────────────────────────────────
# get_previous_close
# ──────────────────────────────────────────────────────────────────────────────

class TestGetPreviousClose:
    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_bar(self):
        respx.get("https://api.polygon.io/v2/aggs/ticker/SPY/prev").mock(
            return_value=httpx.Response(200, json={
                "status": "OK",
                "results": [agg_bar(1704182400000, c=475.0)],
            })
        )

        async with PolygonClient(FAKE_KEY) as client:
            bar = await client.get_previous_close("SPY")

        assert bar is not None
        assert bar.close == 475.0
        assert bar.timeframe == Timeframe.DAY_1

    @pytest.mark.asyncio
    @respx.mock
    async def test_no_results_returns_none(self):
        respx.get("https://api.polygon.io/v2/aggs/ticker/FAKE/prev").mock(
            return_value=httpx.Response(200, json={"status": "OK", "results": []})
        )

        async with PolygonClient(FAKE_KEY) as client:
            bar = await client.get_previous_close("FAKE")

        assert bar is None


# ──────────────────────────────────────────────────────────────────────────────
# PolygonClient initialisation
# ──────────────────────────────────────────────────────────────────────────────

class TestClientInit:
    def test_empty_api_key_raises(self):
        with pytest.raises(ValueError, match="POLYGON_API_KEY"):
            PolygonClient("")

    def test_requires_context_manager(self):
        client = PolygonClient(FAKE_KEY)
        with pytest.raises(AssertionError):
            import asyncio
            asyncio.get_event_loop().run_until_complete(
                client.get_bars("AAPL", Timeframe.DAY_1)
            )
