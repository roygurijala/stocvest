"""
Polygon client tests — all HTTP calls are mocked with respx.

No real API key or network needed.  Marked pytest.mark.unit.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone, date

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

    # ------------------------------------------------------------------
    # Recency / sort regression (BRK-B Issue 3 fix, 2026-05-13)
    # ------------------------------------------------------------------
    #
    # Before the fix get_bars sent sort=asc with a default
    # from_date="2000-01-01", which on Polygon returns the OLDEST
    # N bars in the date range — i.e. bars from 2003-era data.
    # Every technical analyzer in the codebase was running on
    # 22-year-old prices. Tests below pin the corrected behaviour:
    #
    #   1. "recent N bars" mode (no dates provided) MUST request
    #      sort=desc so the most recent bars are returned, and the
    #      caller-facing list MUST still be oldest-first (reversed).
    #   2. Explicit-date-range mode MUST keep sort=asc (callers like
    #      sector_daily_cache and orb_compute_worker rely on it).

    @pytest.mark.asyncio
    @respx.mock
    async def test_recent_mode_sends_sort_desc_and_returns_oldest_first(self) -> None:
        """No from/to provided → sort=desc on the wire, oldest-first on return."""
        route = respx.get(
            url__regex=r"https://api\.polygon\.io/v2/aggs/ticker/AAPL/range/1/day/2000-01-01/.+"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "OK",
                    # Polygon returns newest-first when sort=desc.
                    "results": [
                        agg_bar(2_000_000_000_000),  # newest
                        agg_bar(1_000_000_000_000),  # mid
                        agg_bar(500_000_000_000),    # oldest
                    ],
                },
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            bars = await client.get_bars("AAPL", Timeframe.DAY_1)
        assert route.called
        sent_params = dict(route.calls[0].request.url.params)
        assert sent_params.get("sort") == "desc", (
            "Recent-N-bars mode MUST send sort=desc so Polygon returns the newest bars, "
            "not the oldest in the [2000-01-01, today] range."
        )
        # The reverse on our side restores oldest-first chronology so
        # every analyzer downstream (SMA windows, RSI seed, MACD seed)
        # keeps working unchanged.
        ts_ms = [int(b.timestamp.timestamp() * 1000) for b in bars]
        assert ts_ms == sorted(ts_ms), (
            "Bars returned to the caller MUST be oldest-first regardless of how Polygon ordered them."
        )

    @pytest.mark.asyncio
    @respx.mock
    async def test_explicit_date_range_keeps_sort_asc(self) -> None:
        """Date range mode (case B) must NOT regress to desc — callers depend on asc-within-range."""
        route = respx.get(
            "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-01-10"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"status": "OK", "results": [agg_bar(1_704_182_400_000)]},
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            await client.get_bars("AAPL", Timeframe.DAY_1, from_date="2024-01-01", to_date="2024-01-10")
        assert route.called
        sent_params = dict(route.calls[0].request.url.params)
        assert sent_params.get("sort") == "asc", (
            "When both from_date and to_date are explicitly provided, get_bars must keep "
            "sort=asc — sector_daily_cache and orb_compute_worker rely on oldest-first within the window."
        )

    @pytest.mark.asyncio
    @respx.mock
    async def test_partial_dates_still_treated_as_range_mode(self) -> None:
        """If only one of from/to is provided, that's still a range request (not recent-N)."""
        # Caller pinned to_date only — they still mean "bars up to this date".
        route = respx.get(
            url__regex=r"https://api\.polygon\.io/v2/aggs/ticker/AAPL/range/1/day/2000-01-01/2024-01-02"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"status": "OK", "results": [agg_bar(1_704_182_400_000)]},
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            await client.get_bars("AAPL", Timeframe.DAY_1, to_date="2024-01-02")
        sent_params = dict(route.calls[0].request.url.params)
        # Partial-date mode is treated as explicit range (sort=asc) to
        # avoid surprising callers who pinned one edge.
        assert sent_params.get("sort") == "asc"


class TestGetEvaluatedPriceAfterSignal:
    @pytest.mark.asyncio
    @respx.mock
    async def test_1h_horizon_uses_last_bar_close_at_or_before_target(self) -> None:
        gen = datetime(2024, 1, 2, 14, 0, 0, tzinfo=timezone.utc)
        window_end = gen + timedelta(hours=1) + timedelta(days=7)
        from_ms = int(gen.timestamp() * 1000)
        to_ms = int(window_end.timestamp() * 1000)
        url = f"https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/{from_ms}/{to_ms}"
        t1 = from_ms
        t2 = from_ms + 3_600_000
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        agg_bar(t1, c=100.0),
                        agg_bar(t2, c=105.25),
                    ],
                },
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            px = await client.get_evaluated_price_after_signal("SPY", gen, horizon="1h")
        assert px == 105.25

    @pytest.mark.asyncio
    @respx.mock
    async def test_1d_horizon_uses_same_day_rth_close_when_generated_before_close(self) -> None:
        # 2024-01-02 15:00 ET (20:00 UTC) => next session close is same day 16:00 ET (21:00 UTC)
        gen = datetime(2024, 1, 2, 20, 0, 0, tzinfo=timezone.utc)
        target = datetime(2024, 1, 2, 21, 0, 0, tzinfo=timezone.utc)
        window_end = target + timedelta(days=7)
        from_ms = int(gen.timestamp() * 1000)
        to_ms = int(window_end.timestamp() * 1000)
        url = f"https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/{from_ms}/{to_ms}"
        t_before_close = int(datetime(2024, 1, 2, 20, 59, 0, tzinfo=timezone.utc).timestamp() * 1000)
        t_after_close = int(datetime(2024, 1, 2, 21, 1, 0, tzinfo=timezone.utc).timestamp() * 1000)
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        agg_bar(t_before_close, c=501.0),
                        agg_bar(t_after_close, c=505.0),
                    ],
                },
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            px = await client.get_evaluated_price_after_signal("SPY", gen, horizon="1d")
        assert px == 501.0

    @pytest.mark.asyncio
    @respx.mock
    async def test_1d_horizon_uses_next_weekday_close_when_generated_after_close(self) -> None:
        # 2024-01-02 16:30 ET (21:30 UTC) => next session close is 2024-01-03 16:00 ET (21:00 UTC)
        gen = datetime(2024, 1, 2, 21, 30, 0, tzinfo=timezone.utc)
        target = datetime(2024, 1, 3, 21, 0, 0, tzinfo=timezone.utc)
        window_end = target + timedelta(days=7)
        from_ms = int(gen.timestamp() * 1000)
        to_ms = int(window_end.timestamp() * 1000)
        url = f"https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/{from_ms}/{to_ms}"
        t_prev_day = int(datetime(2024, 1, 2, 21, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
        t_next_close = int(datetime(2024, 1, 3, 20, 59, 0, tzinfo=timezone.utc).timestamp() * 1000)
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        agg_bar(t_prev_day, c=495.0),
                        agg_bar(t_next_close, c=510.0),
                    ],
                },
            )
        )
        async with PolygonClient(FAKE_KEY) as client:
            px = await client.get_evaluated_price_after_signal("SPY", gen, horizon="1d")
        assert px == 510.0


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

    @pytest.mark.asyncio
    @respx.mock
    async def test_bid_ask_mapping_uses_distinct_fields(self):
        payload = {
            "status": "OK",
            "ticker": {
                "ticker": "AAPL",
                "day": {"o": 185.0, "h": 188.0, "l": 183.0, "c": 187.0, "v": 50_000_000, "vw": 186.0},
                "prevDay": {"c": 183.0},
                "lastTrade": {"p": 187.0, "s": 100},
                "lastQuote": {"P": 186.99, "p": 187.02},
                "market": "open",
            },
        }
        respx.get(
            "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/AAPL"
        ).mock(return_value=httpx.Response(200, json=payload))

        async with PolygonClient(FAKE_KEY) as client:
            snap = await client.get_snapshot("AAPL")

        assert snap.last_quote_bid == pytest.approx(186.99)
        assert snap.last_quote_ask == pytest.approx(187.02)

    @pytest.mark.asyncio
    @respx.mock
    async def test_snapshot_parses_pre_and_after_hours_fields(self):
        payload = {
            "status": "OK",
            "ticker": {
                "ticker": "AAPL",
                "day": {"o": 185.0, "h": 188.0, "l": 183.0, "c": 187.0, "v": 50_000_000, "vw": 186.0},
                "prevDay": {"c": 183.0},
                "lastTrade": {"p": 187.0, "s": 100},
                "lastQuote": {"P": 186.99, "p": 187.02},
                "preMarket": {"p": 188.5, "cp": 1.2},
                "afterHours": {"p": 186.1, "cp": -0.5},
                "market": "open",
            },
        }
        respx.get(
            "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/AAPL"
        ).mock(return_value=httpx.Response(200, json=payload))

        async with PolygonClient(FAKE_KEY) as client:
            snap = await client.get_snapshot("AAPL")

        assert snap.pre_market_price == pytest.approx(188.5)
        assert snap.pre_market_change_percent == pytest.approx(1.2)
        assert snap.after_hours_price == pytest.approx(186.1)
        assert snap.after_hours_change_percent == pytest.approx(-0.5)


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
    async def test_get_market_news_with_ticker_any_of_and_time_filter(self):
        payload = {
            "status": "OK",
            "results": [
                {
                    "id": "spy1",
                    "published_utc": "2024-01-02T14:30:00Z",
                    "title": "ETF flows",
                    "description": "SPY",
                    "article_url": "https://example.com/article",
                    "publisher": {"name": "Reuters"},
                    "tickers": ["SPY", "QQQ"],
                    "keywords": ["etf"],
                }
            ],
        }
        route = respx.get("https://api.polygon.io/v2/reference/news").mock(
            return_value=httpx.Response(200, json=payload)
        )
        since = datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc)

        async with PolygonClient(FAKE_KEY, benzinga_api_key="") as client:
            rows = await client.get_market_news(
                tickers=["SPY", "QQQ"],
                limit=50,
                published_utc_gte=since,
            )

        assert len(rows) == 1
        req = route.calls[0].request
        assert req.url.params.get("ticker.any_of") == "SPY,QQQ"
        assert req.url.params.get("limit") == "50"
        assert req.url.params.get("order") == "desc"
        assert req.url.params.get("published_utc.gte", "").endswith("Z")

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

    @pytest.mark.asyncio
    @respx.mock
    async def test_news_paginates_until_limit(self):
        first_page = {
            "status": "OK",
            "results": [
                {
                    "id": "a1",
                    "published_utc": "2024-01-02T14:30:00Z",
                    "title": "First article",
                    "description": "first",
                    "article_url": "https://example.com/a1",
                    "publisher": {"name": "Reuters"},
                    "tickers": ["AAPL"],
                    "keywords": [],
                }
            ],
            "next_url": "https://api.polygon.io/v2/reference/news?cursor=abc",
        }
        second_page = {
            "status": "OK",
            "results": [
                {
                    "id": "a2",
                    "published_utc": "2024-01-02T14:31:00Z",
                    "title": "Second article",
                    "description": "second",
                    "article_url": "https://example.com/a2",
                    "publisher": {"name": "Reuters"},
                    "tickers": ["AAPL"],
                    "keywords": [],
                }
            ],
        }
        route = respx.get("https://api.polygon.io/v2/reference/news")
        route.side_effect = [
            httpx.Response(200, json=first_page),
            httpx.Response(200, json=second_page),
        ]

        async with PolygonClient(FAKE_KEY) as client:
            articles = await client.get_news("AAPL", limit=2)

        assert [a.article_id for a in articles] == ["a1", "a2"]
        assert route.call_count == 2


class TestNewsRowTickerFilter:
    def test_matches_intersection(self):
        assert PolygonClient._news_row_matches_requested_tickers({"tickers": ["PINS"]}, ["PINS"])
        assert PolygonClient._news_row_matches_requested_tickers(
            {"tickers": ["PINS", "COTY"]}, ["PINS"]
        )
        assert not PolygonClient._news_row_matches_requested_tickers({"tickers": ["COTY"]}, ["PINS"])
        assert not PolygonClient._news_row_matches_requested_tickers({"tickers": []}, ["PINS"])
        assert not PolygonClient._news_row_matches_requested_tickers({}, ["PINS"])

    def test_no_requested_means_pass_through(self):
        assert PolygonClient._news_row_matches_requested_tickers({"tickers": ["COTY"]}, [])

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_market_news_drops_mistagged_rows(self):
        mixed = {
            "status": "OK",
            "results": [
                {
                    "id": "1",
                    "published_utc": "2024-01-02T14:30:00Z",
                    "title": "PINS earnings beat",
                    "article_url": "https://example.com/1",
                    "tickers": ["PINS"],
                },
                {
                    "id": "2",
                    "published_utc": "2024-01-02T14:29:00Z",
                    "title": "Coty lawsuit",
                    "article_url": "https://example.com/2",
                    "tickers": ["COTY"],
                },
            ],
        }
        respx.get("https://api.polygon.io/v2/reference/news").mock(
            return_value=httpx.Response(200, json=mixed)
        )
        async with PolygonClient(FAKE_KEY, benzinga_api_key="") as client:
            rows = await client.get_market_news(tickers=["PINS"], limit=20)
        assert len(rows) == 1
        assert rows[0]["tickers"] == ["PINS"]


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


class TestAdditionalRestEndpoints:
    @pytest.mark.asyncio
    @respx.mock
    async def test_get_snapshots_returns_symbol_map(self):
        payload = {
            "status": "OK",
            "tickers": [
                {"ticker": "AAPL", "day": {"c": 190.0}, "prevDay": {"c": 188.0}, "lastTrade": {"p": 190.0}},
                {"ticker": "MSFT", "day": {"c": 410.0}, "prevDay": {"c": 405.0}, "lastTrade": {"p": 410.0}},
            ],
        }
        respx.get("https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            snaps = await client.get_snapshots(["AAPL", "MSFT"])

        assert set(snaps.keys()) == {"AAPL", "MSFT"}
        assert snaps["AAPL"].symbol == "AAPL"

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_us_stocks_market_snapshots_paginates(self):
        page1 = {
            "status": "OK",
            "tickers": [
                {
                    "ticker": "AAA",
                    "day": {"o": 10.0, "v": 1_000_000},
                    "prevDay": {"c": 9.0},
                    "lastTrade": {"p": 10.0},
                },
            ],
            "next_url": "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?cursor=abc&include_otc=false",
        }
        page2 = {
            "status": "OK",
            "tickers": [
                {
                    "ticker": "BBB",
                    "day": {"c": 20.0, "v": 1_000_000},
                    "prevDay": {"c": 19.0},
                    "lastTrade": {"p": 20.0},
                },
            ],
        }
        route = respx.get(url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers.*")
        route.side_effect = [
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ]

        async with PolygonClient(FAKE_KEY) as client:
            rows = await client.get_us_stocks_market_snapshots(include_otc=False)

        assert [s.symbol for s in rows] == ["AAA", "BBB"]
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_snapshots_many_batches_requests(self):
        def _ticker(sym: str, p: float, last: float) -> dict:
            return {
                "ticker": sym,
                "day": {"c": last, "v": 1_000_000},
                "prevDay": {"c": p},
                "lastTrade": {"p": last},
            }

        route = respx.get(url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers.*")
        route.side_effect = [
            httpx.Response(200, json={"status": "OK", "tickers": [_ticker("A", 10.0, 10.0)]}),
            httpx.Response(200, json={"status": "OK", "tickers": [_ticker("B", 20.0, 20.0)]}),
        ]

        async with PolygonClient(FAKE_KEY) as client:
            snaps = await client.get_snapshots_many(["A", "B"], chunk_size=1)

        assert {s.symbol for s in snaps} == {"A", "B"}
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_gainers_losers_returns_snapshots(self):
        payload = {
            "status": "OK",
            "tickers": [
                {"ticker": "NVDA", "day": {"c": 950.0}, "prevDay": {"c": 900.0}, "lastTrade": {"p": 950.0}},
            ],
        }
        respx.get("https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            gainers = await client.get_gainers_losers("gainers")

        assert len(gainers) == 1
        assert isinstance(gainers[0], Snapshot)

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_options_chain_parses_contracts(self):
        payload = {
            "status": "OK",
            "results": [
                {
                    "details": {
                        "ticker": "AAPL250117C00150000",
                        "expiration_date": "2025-01-17",
                        "strike_price": 150.0,
                        "contract_type": "call",
                    },
                    "greeks": {"delta": 0.55},
                    "last_quote": {"bid": 4.9, "ask": 5.1},
                    "day": {"volume": 1200},
                    "open_interest": 7500,
                    "implied_volatility": 0.28,
                    "last_trade": {"price": 5.0},
                }
            ],
        }
        respx.get("https://api.polygon.io/v3/snapshot/options/AAPL").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            contracts = await client.get_options_chain("AAPL")

        assert len(contracts) == 1
        assert isinstance(contracts[0], OptionContract)
        assert contracts[0].symbol == "AAPL250117C00150000"
        assert contracts[0].bid == pytest.approx(4.9)

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_market_status_parses_payload(self):
        payload = {
            "market": "open",
            "serverTime": "2026-04-28T14:00:00Z",
            "exchanges": {"nasdaq": "open"},
            "currencies": {"fx": "open"},
        }
        respx.get("https://api.polygon.io/v1/marketstatus/now").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            status = await client.get_market_status()

        assert status.market == "open"
        assert status.exchanges["nasdaq"] == "open"

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_ticker_details_returns_results_dict(self):
        payload = {"status": "OK", "results": {"ticker": "AAPL", "name": "Apple Inc."}}
        respx.get("https://api.polygon.io/v3/reference/tickers/AAPL").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            details = await client.get_ticker_details("AAPL")

        assert details["ticker"] == "AAPL"

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_earnings_calendar_returns_events(self):
        payload = {
            "status": "OK",
            "results": [
                {
                    "ticker": "AAPL",
                    "company_name": "Apple Inc.",
                    "date": "2026-05-05",
                    "time": "07:00:00",
                    "estimated_eps": 1.55,
                    "actual_eps": 1.65,
                    "eps_surprise_percent": 6.5,
                    "fiscal_period": "Q2",
                    "fiscal_year": 2026,
                }
            ],
        }
        respx.get("https://api.polygon.io/benzinga/v1/earnings").mock(
            return_value=httpx.Response(200, json=payload)
        )

        async with PolygonClient(FAKE_KEY) as client:
            rows = await client.get_earnings_calendar(["AAPL"], from_date="2026-05-01", to_date="2026-05-10")

        assert len(rows) == 1
        assert rows[0].symbol == "AAPL"
        assert rows[0].report_time == "before_market"
        assert rows[0].actual_eps == pytest.approx(1.65)

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_earnings_calendar_follows_next_url(self):
        page1 = {
            "status": "OK",
            "next_url": "https://api.polygon.io/benzinga/v1/earnings?cursor=abc&apiKey=poly-test",
            "results": [
                {
                    "ticker": "AAPL",
                    "company_name": "Apple Inc.",
                    "date": "2026-05-05",
                    "time": "16:00:00",
                    "fiscal_period": "Q2",
                    "fiscal_year": 2026,
                }
            ],
        }
        page2 = {
            "status": "OK",
            "results": [
                {
                    "ticker": "MSFT",
                    "company_name": "Microsoft Corp",
                    "date": "2026-05-06",
                    "time": "bmo",
                    "fiscal_period": "Q3",
                    "fiscal_year": 2026,
                }
            ],
        }
        route = respx.get("https://api.polygon.io/benzinga/v1/earnings")
        route.side_effect = [
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ]

        async with PolygonClient(FAKE_KEY) as client:
            rows = await client.get_earnings_calendar(
                ["AAPL", "MSFT"], from_date="2026-05-01", to_date="2026-05-10"
            )

        assert len(rows) == 2
        assert rows[0].symbol == "AAPL"
        assert rows[0].report_time == "after_market"
        assert rows[1].symbol == "MSFT"


class TestRetries:
    @pytest.mark.asyncio
    @respx.mock
    async def test_get_retries_on_429_then_succeeds(self):
        route = respx.get(
            "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2000-01-01/2024-01-02"
        )
        route.side_effect = [
            httpx.Response(429, text="Too Many Requests"),
            httpx.Response(200, json={"status": "OK", "results": [agg_bar(1704182400000)]}),
        ]

        async with PolygonClient(FAKE_KEY, retry_backoff_seconds=0.0) as client:
            bars = await client.get_bars("AAPL", Timeframe.DAY_1, to_date="2024-01-02")

        assert len(bars) == 1
        assert route.call_count == 2


# ──────────────────────────────────────────────────────────────────────────────
# PolygonClient initialisation
# ──────────────────────────────────────────────────────────────────────────────


class TestParseIndexSnapshotRow:
    def test_indices_vix_row_maps_to_snapshot(self):
        row = {
            "ticker": "I:VIX",
            "value": 18.42,
            "market_status": "open",
            "session": {
                "change": 0.22,
                "change_percent": 1.2,
                "close": 18.42,
                "high": 19.0,
                "low": 17.8,
                "open": 18.0,
                "previous_close": 18.2,
            },
        }
        snap = PolygonClient._parse_index_snapshot_row("I:VIX", row)
        assert snap is not None
        assert snap.last_trade_price == pytest.approx(18.42)
        assert snap.change_percent == pytest.approx(1.2)

    def test_indices_error_row_returns_none(self):
        row = {"ticker": "I:VIX", "error": "NOT_ENTITLED", "message": "nope"}
        assert PolygonClient._parse_index_snapshot_row("I:VIX", row) is None


class TestParseSnapshotIndexFallback:
    def test_vix_like_payload_without_last_trade_uses_day_close(self):
        ticker = {
            "ticker": "I:VIX",
            "day": {"o": 18.0, "h": 19.0, "l": 17.5, "c": 18.5, "v": 1},
            "prevDay": {"c": 18.0, "v": 100},
            "lastTrade": {},
        }
        snap = PolygonClient._parse_snapshot("I:VIX", ticker)
        assert snap.last_trade_price == pytest.approx(18.5)
        assert snap.change is not None and snap.change_percent is not None

    def test_vix_uses_quote_mid_when_no_last_trade(self):
        ticker = {
            "ticker": "I:VIX",
            "day": {"o": 18.0, "h": 19.0, "l": 17.5, "c": 18.5, "v": 1},
            "prevDay": {"c": 18.0, "v": 100},
            "lastTrade": {},
            "lastQuote": {"P": 18.45, "p": 18.55},
        }
        snap = PolygonClient._parse_snapshot("I:VIX", ticker)
        assert snap.last_trade_price == pytest.approx(18.5)
        assert snap.change is not None

    def test_equity_does_not_use_quote_when_last_trade_missing(self):
        ticker = {
            "ticker": "AAPL",
            "day": {"o": 198, "h": 202, "l": 196, "c": 201, "v": 1, "vw": 199},
            "prevDay": {"c": 197},
            "lastTrade": {},
            "lastQuote": {"P": 199.9, "p": 200.1},
        }
        snap = PolygonClient._parse_snapshot("AAPL", ticker)
        assert snap.last_trade_price is None

class TestClientInit:
    def test_empty_api_key_raises(self):
        with pytest.raises(ValueError, match="POLYGON_API_KEY"):
            PolygonClient("")

    def test_requires_context_manager(self):
        client = PolygonClient(FAKE_KEY)
        with pytest.raises(AssertionError):
            import asyncio
            asyncio.run(client.get_bars("AAPL", Timeframe.DAY_1))


class TestWebsocketParsers:
    def test_parse_ws_bar_uses_minute_volume_not_accumulated_volume(self):
        client = PolygonClient(FAKE_KEY)
        msg = {
            "ev": "A",
            "sym": "AAPL",
            "s": 1704182400000,
            "o": 100.0,
            "h": 101.0,
            "l": 99.0,
            "c": 100.5,
            "v": 12345,      # minute volume
            "av": 9999999,   # session cumulative volume
            "vw": 100.3,
        }
        bar = client._parse_ws_bar(msg)
        assert bar is not None
        assert bar.volume == pytest.approx(12345)
