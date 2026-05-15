"""
Polygon.io data client — covers everything STOCVEST needs:

  REST (httpx):
    • Aggregate bars (any timeframe, any multiplier)
    • Snapshot API (pre-market gaps, intraday scanner)
    • News (with pagination)
    • Options chain + Greeks
    • Market status / calendar
    • Benzinga earnings calendar (partner REST)

  WebSocket (websockets):
    • Real-time trades  (T.*)
    • Real-time quotes  (Q.*)
    • Real-time 1-min bars  (A.*)

All methods return canonical models from stocvest.data.models — no raw
Polygon dicts leak out.  Callers never need to know it's Polygon.

Rate limits:
  Stocks Advanced  →  unlimited REST calls, real-time WebSocket
  Options Starter  →  15-min delayed options data
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Awaitable, Callable, Optional, Union
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import websockets
import json

from stocvest.utils.api_rate_limits import await_polygon_rest_slot

from stocvest.data.models import (
    Bar,
    EarningsEvent,
    EconomicCalendarEvent,
    MarketStatus,
    NewsArticle,
    OptionContract,
    Quote,
    Snapshot,
    Timeframe,
    Trade,
)
from stocvest.utils.redis_client import get_sync_redis
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

_POLYGON_REST_BASE = "https://api.polygon.io"
_POLYGON_WS_BASE   = "wss://socket.polygon.io"
_BENZINGA_NEWS_WS_BASE = "wss://api.benzinga.com/api/v1/news/stream"
_US_EASTERN = ZoneInfo("America/New_York")

# Polygon occasionally returns a `day` OHLC/VWAP block on a different price scale than
# `lastTrade.p` (bad aggregate / stale session). Only compare when `last_trade_price` is a
# positive number; otherwise keep the session bar. Ratio uses a loose bound to avoid
# false positives on valid tape (2.5× was too tight in production).
_DAY_VS_LAST_MAX_RATIO = 5.0

LIQUID_NEWS_TICKERS = [
    "SPY",
    "QQQ",
    "AAPL",
    "NVDA",
    "TSLA",
    "MSFT",
    "AMZN",
    "META",
    "AMD",
    "GOOGL",
    "NFLX",
    "UBER",
    "COIN",
    "GS",
    "JPM",
    "BAC",
    "XLF",
    "XLK",
    "XLE",
    "SOFI",
]


# ─── timeframe → Polygon multiplier + timespan ────────────────────────────────

_TIMEFRAME_MAP: dict[Timeframe, tuple[int, str]] = {
    Timeframe.MIN_1:  (1,  "minute"),
    Timeframe.MIN_5:  (5,  "minute"),
    Timeframe.MIN_15: (15, "minute"),
    Timeframe.MIN_30: (30, "minute"),
    Timeframe.HOUR_1: (1,  "hour"),
    Timeframe.HOUR_4: (4,  "hour"),
    Timeframe.DAY_1:  (1,  "day"),
    Timeframe.WEEK_1: (1,  "week"),
}


class PolygonError(Exception):
    """Raised when Polygon returns a non-OK response."""


class PolygonClient:
    """
    Async client for Polygon.io.

    Usage:
        async with PolygonClient(api_key="...") as client:
            bars = await client.get_bars("AAPL", Timeframe.MIN_1, limit=200)
    """

    def __init__(
        self,
        api_key: str,
        benzinga_api_key: str | None = None,
        benzinga_news_ws_url: str = _BENZINGA_NEWS_WS_BASE,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        if not api_key:
            raise ValueError("POLYGON_API_KEY is required")
        if benzinga_api_key is None:
            try:
                from stocvest.utils.config import get_settings

                cfg = get_settings()
                benzinga_api_key = cfg.benzinga_api_key
                benzinga_news_ws_url = cfg.benzinga_news_ws_url or benzinga_news_ws_url
            except Exception:
                benzinga_api_key = ""
        self._api_key = api_key
        self._benzinga_api_key = (benzinga_api_key or "").strip()
        self._benzinga_news_ws_url = str(benzinga_news_ws_url or _BENZINGA_NEWS_WS_BASE).strip() or _BENZINGA_NEWS_WS_BASE
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_backoff_seconds = retry_backoff_seconds
        self._http: Optional[httpx.AsyncClient] = None

    # ── Context manager ────────────────────────────────────────────────────────

    async def __aenter__(self) -> "PolygonClient":
        self._http = httpx.AsyncClient(
            base_url=_POLYGON_REST_BASE,
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=self._timeout,
        )
        return self

    async def __aexit__(self, *_) -> None:
        if self._http:
            await self._http.aclose()

    # ── Internal helpers ───────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> dict:
        assert self._http, "Use 'async with PolygonClient(...) as client:'"
        params = params or {}
        log.debug("GET %s params=%s", path, {k: v for k, v in params.items() if k != "apiKey"})
        last_error: Exception | None = None
        last_status: int | None = None
        last_body_snippet = ""

        for attempt in range(self._max_retries + 1):
            try:
                await await_polygon_rest_slot()
                resp = await self._http.get(path, params=params)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    break
                await asyncio.sleep(self._retry_backoff_seconds * (2**attempt))
                continue

            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "")
                if status not in ("OK", "DELAYED", ""):
                    raise PolygonError(f"Polygon status={status} on {path}: {data.get('error', '')}")
                return data

            if resp.status_code in (429, 500, 502, 503, 504) and attempt < self._max_retries:
                last_status = resp.status_code
                last_body_snippet = resp.text[:200]
                await asyncio.sleep(self._retry_backoff_seconds * (2**attempt))
                continue

            raise PolygonError(f"Polygon {resp.status_code} on {path}: {resp.text[:200]}")

        if last_status is not None:
            raise PolygonError(
                f"Polygon {last_status} on {path} after retries: {last_body_snippet}"
            )
        raise PolygonError(f"Polygon request failed on {path}: {type(last_error).__name__}")

    @staticmethod
    def _ts_ms_to_dt(ts_ms: int) -> datetime:
        """Convert Polygon millisecond timestamp to UTC datetime."""
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)

    @staticmethod
    def _ts_ns_to_dt(ts_ns: int) -> datetime:
        """Convert Polygon nanosecond timestamp to UTC datetime."""
        return datetime.fromtimestamp(ts_ns / 1_000_000_000, tz=timezone.utc)

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Aggregate Bars
    # ──────────────────────────────────────────────────────────────────────────

    async def get_bars(
        self,
        symbol:     str,
        timeframe:  Timeframe,
        from_date:  Optional[date | str] = None,
        to_date:    Optional[date | str] = None,
        limit:      int = 200,
        adjusted:   bool = True,
    ) -> list[Bar]:
        """
        Fetch OHLCV bars for a symbol.

        Args:
            symbol:     Ticker e.g. "AAPL"
            timeframe:  Timeframe enum value
            from_date:  Start date (inclusive).  Optional.
            to_date:    End date (inclusive).    Optional.
            limit:      Max bars to return (Polygon cap: 50,000).
            adjusted:   True = split/dividend adjusted prices.

        Returns:
            List of Bar objects, oldest-first.

        Two calling modes (and they MUST behave differently):

        1. "Recent N bars" — callers pass `limit=N` and leave the date range
           open (``from_date=None`` and ``to_date=None``). They want the most
           recent N bars from today's perspective. This is by far the dominant
           use case across the codebase (every composite-engine technical
           layer, the scanner pipeline, the public ``/v1/bars`` handler when
           no dates are supplied, etc.).
        2. "Bars within an explicit date range" — callers pass concrete dates
           and want every bar inside that window, oldest-first, capped by
           ``limit``. Examples: ``sector_daily_cache`` for a trailing 7-day
           audit, ``orb_compute_worker`` for a single trading day's minute
           bars.

        Why this matters — the BRK-B regression of 2026-05-13
        ===================================================
        The previous implementation always sent ``sort=asc`` with a
        default ``from_date="2000-01-01"``. The comment claimed Polygon
        "ignores from_date if limit is set" — that comment was wrong.
        Polygon honours both: with ``sort=asc`` and a date range, you get
        the OLDEST N bars in the range. So when a caller asked for "last
        60 minute bars" of BRK.B, the engine actually received 60 minute
        bars from **2003-09-10**. Live probe before fix::

            get_bars('BRK.B', MIN_1, limit=60)
              → FIRST bar 2003-09-10T13:33:00, close ≈ $50
              → LAST  bar 2003-09-10T15:50:00, close ≈ $50
            get_bars('BRK.B', DAY_1, limit=210)
              → FIRST bar 2003-09-10, close ≈ $58
              → LAST  bar 2004-07-12, close ≈ $61

        Every technical computation downstream (SMA50, SMA200, RSI,
        MACD, VWAP, EMAs, golden cross, ATR, volatility regime, breakout
        detection) was running against 22-year-old prices instead of
        the current tape. The visible symptom was BRK.B's intraday VWAP
        rendering as ``$50.36`` (the price post the 2010 50:1 split) on
        a stock that trades near ``$485`` today, and almost every name
        rendering "Above SMA50 / Above SMA200" because today's price is
        of course higher than 2003-era prices for nearly any equity.

        The fix below makes mode 1 actually return the most recent bars
        (``sort=desc`` then reverse on the wire to maintain the
        oldest-first contract callers expect) while leaving mode 2
        untouched (explicit dates → explicit asc-within-range).
        """
        multiplier, timespan = _TIMEFRAME_MAP[timeframe]

        # "Recent N bars" mode: caller did not pin either edge of the
        # range, so they want the most recent N. Anchor the to_date at
        # today, the from_date at the earliest data Polygon has, and
        # ask Polygon to walk BACKWARDS from today (sort=desc) up to
        # ``limit`` bars. The result is then reversed to oldest-first
        # so every caller still receives bars in chronological order.
        recent_mode = from_date is None and to_date is None

        if to_date is None:
            to_date = date.today().isoformat()
        if from_date is None:
            from_date = "2000-01-01"

        params = {
            "adjusted": str(adjusted).lower(),
            "sort":     "desc" if recent_mode else "asc",
            "limit":    str(limit),
        }

        path = f"/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from_date}/{to_date}"
        data = await self._get(path, params)

        results = data.get("results") or []
        if recent_mode:
            # Polygon returned newest-first; flip to the oldest-first
            # contract every caller expects (and every downstream analyzer
            # assumes — SMA windows, RSI seed, MACD seed, etc.).
            results = list(reversed(results))

        bars: list[Bar] = []
        for r in results:
            bars.append(Bar(
                symbol=symbol,
                timestamp=self._ts_ms_to_dt(r["t"]),
                timeframe=timeframe,
                open=r["o"],
                high=r["h"],
                low=r["l"],
                close=r["c"],
                volume=r["v"],
                vwap=r.get("vw"),
                transactions=r.get("n"),
            ))
        log.debug(
            "get_bars(%s, %s) → %d bars (mode=%s)",
            symbol,
            timeframe.value,
            len(bars),
            "recent" if recent_mode else "range",
        )
        return bars

    async def get_evaluated_price_after_signal(
        self,
        symbol: str,
        generated_at: datetime,
        *,
        horizon: str,
    ) -> float | None:
        """
        Close of the last completed 1-minute bar whose start is at or before the evaluation
        instant.

        - ``1h``: generated_at + 60 minutes
        - ``1d``: next US equities RTH close (4:00 PM ET), not rolling +24h

        Used for signal outcome
        tracking (not live snapshot).
        """
        if horizon not in ("1h", "1d"):
            raise ValueError("horizon must be '1h' or '1d'")
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=timezone.utc)
        gen = generated_at.astimezone(timezone.utc)
        if horizon == "1h":
            target = gen + timedelta(minutes=60)
        else:
            target = self._next_rth_session_close_utc(gen)
        # Cover weekends / thin tape: extend query window forward.
        window_end = target + timedelta(days=7)
        from_ms = int(gen.timestamp() * 1000)
        to_ms = int(window_end.timestamp() * 1000)
        sym = symbol.strip().upper()
        path = f"/v2/aggs/ticker/{sym}/range/1/minute/{from_ms}/{to_ms}"
        params = {"adjusted": "true", "sort": "asc", "limit": "50000"}
        data = await self._get(path, params)
        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            return None
        target_ms = int(target.timestamp() * 1000)
        best_close: float | None = None
        best_t = -1
        for r in results:
            if not isinstance(r, dict) or "t" not in r or "c" not in r:
                continue
            try:
                t0 = int(r["t"])
                close = float(r["c"])
            except (TypeError, ValueError):
                continue
            if t0 <= target_ms and t0 >= best_t:
                best_t = t0
                best_close = close
        return best_close

    @staticmethod
    def _next_rth_session_close_utc(generated_at_utc: datetime) -> datetime:
        """
        Next regular-session close timestamp (4:00 PM ET) strictly after ``generated_at_utc``.
        Weekday-only approximation; exchange holidays are not modeled here.
        """
        et = generated_at_utc.astimezone(_US_EASTERN)
        close_et = et.replace(hour=16, minute=0, second=0, microsecond=0)
        if et.weekday() < 5 and et < close_et:
            target_et = close_et
        else:
            next_day = et + timedelta(days=1)
            while next_day.weekday() >= 5:
                next_day += timedelta(days=1)
            target_et = next_day.replace(hour=16, minute=0, second=0, microsecond=0)
        return target_et.astimezone(timezone.utc)

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Snapshot (intraday scanner + pre-market gaps)
    # ──────────────────────────────────────────────────────────────────────────

    async def get_snapshot(self, symbol: str) -> Snapshot:
        """Fetch a single ticker's full snapshot (last trade, quote, day bar, pre/after)."""
        data = await self._get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}")
        ticker = data.get("ticker", {})
        return self._parse_snapshot(symbol, ticker)

    async def get_snapshots(self, symbols: list[str]) -> dict[str, Snapshot]:
        """
        Fetch snapshots for multiple tickers in one API call.
        Returns dict keyed by symbol.
        """
        if not symbols:
            return {}
        params = {"tickers": ",".join(symbols)}
        data = await self._get("/v2/snapshot/locale/us/markets/stocks/tickers", params)
        result: dict[str, Snapshot] = {}
        for ticker_data in data.get("tickers", []):
            sym = ticker_data.get("ticker", "")
            if sym:
                result[sym] = self._parse_snapshot(sym, ticker_data)
        log.debug("get_snapshots(%d symbols) → %d results", len(symbols), len(result))
        return result

    async def get_snapshots_many(self, symbols: list[str], *, chunk_size: int = 50) -> list[Snapshot]:
        """Batch-fetch snapshots in chunks (Polygon limits request size)."""
        if not symbols:
            return []
        out: list[Snapshot] = []
        for i in range(0, len(symbols), max(1, chunk_size)):
            chunk = symbols[i : i + chunk_size]
            batch = await self.get_snapshots(chunk)
            out.extend(batch.values())
        return out

    async def get_us_stocks_market_snapshots(self, *, include_otc: bool = False) -> list[Snapshot]:
        """
        All US stock tickers in one snapshot feed (paginated via ``next_url``).

        Endpoint: ``GET /v2/snapshot/locale/us/markets/stocks/tickers`` without ``tickers=``.
        Requires a Polygon plan that includes this aggregate snapshot; otherwise expect 403
        (caller should fall back to :data:`LIQUID_SYMBOLS_FALLBACK`).
        """
        snapshots: list[Snapshot] = []
        path = "/v2/snapshot/locale/us/markets/stocks/tickers"
        params: dict[str, str] = {"include_otc": "true" if include_otc else "false"}
        page = 0
        while True:
            data = await self._get(path, params)
            for ticker_data in data.get("tickers", []) or []:
                if not isinstance(ticker_data, dict):
                    continue
                sym = str(ticker_data.get("ticker", "") or "").strip().upper()
                if sym:
                    snapshots.append(self._parse_snapshot(sym, ticker_data))
            next_url = data.get("next_url")
            if not next_url:
                break
            path, params = self._extract_path_and_params(next_url)
            page += 1
            if page >= 100:
                log.warning("get_us_stocks_market_snapshots: safety stop after %d pages", page)
                break
        log.debug("get_us_stocks_market_snapshots → %d tickers", len(snapshots))
        return snapshots

    async def get_gainers_losers(self, direction: str = "gainers") -> list[Snapshot]:
        """
        Fetch top 20 gainers or losers.

        Args:
            direction: "gainers" or "losers"
        """
        if direction not in ("gainers", "losers"):
            raise ValueError("direction must be 'gainers' or 'losers'")
        data = await self._get(f"/v2/snapshot/locale/us/markets/stocks/{direction}")
        snapshots = []
        for ticker_data in data.get("tickers", []):
            sym = ticker_data.get("ticker", "")
            if sym:
                snapshots.append(self._parse_snapshot(sym, ticker_data))
        return snapshots

    @staticmethod
    def _session_day_prices_align_with_last(
        last_price: float | None,
        day_open: float | None,
        day_high: float | None,
        day_low: float | None,
        day_close: float | None,
        day_vwap: float | None,
    ) -> bool:
        """True if session OHLC/VWAP are on the same scale as last trade.

        If `last_trade_price` is missing or non-positive, we cannot validate scale — keep
        the session bar (reference levels from `day` beat n/a).
        """
        if last_price is None or last_price <= 0:
            return True
        for m in (day_open, day_high, day_low, day_close, day_vwap):
            if m is None or m <= 0:
                continue
            ratio = m / last_price if last_price else 0.0
            inv = last_price / m if m else 0.0
            if ratio > _DAY_VS_LAST_MAX_RATIO or inv > _DAY_VS_LAST_MAX_RATIO:
                return False
        return True

    @staticmethod
    def _snapshot_last_trade_may_use_day_close(symbol: str) -> bool:
        """True for Polygon index-style tickers where `day.c` updates without `lastTrade.p`.

        Equities must keep `last_trade_price` None when there is no last print so reference
        levels and scale checks stay honest (see tests/signals/test_reference_levels.py).
        """
        u = (symbol or "").strip().upper()
        return u.startswith("I:") or u.startswith("^") or u == "VIX"

    @staticmethod
    def _parse_snapshot(symbol: str, ticker: dict) -> Snapshot:
        day   = ticker.get("day",       {}) or {}
        prev  = ticker.get("prevDay",   {}) or {}
        last  = ticker.get("lastTrade", {}) or {}
        quote = ticker.get("lastQuote", {}) or {}
        fmh   = ticker.get("fmh",       {}) or {}  # pre-market / after-hours from some endpoints
        pre_market = ticker.get("preMarket", {}) or ticker.get("premarket", {}) or {}
        after_hours = ticker.get("afterHours", {}) or ticker.get("afterhours", {}) or {}

        prev_close = prev.get("c")
        prev_day_volume = prev.get("v")
        raw_lp = last.get("p")
        last_price: float | None
        if raw_lp is None or raw_lp == "":
            last_price = None
        else:
            try:
                last_price = float(raw_lp)
                if last_price <= 0 or last_price != last_price:
                    last_price = None
            except (TypeError, ValueError):
                last_price = None

        pre_market_price = PolygonClient._first_present(
            pre_market.get("p"),
            pre_market.get("price"),
            fmh.get("preMarket"),
            fmh.get("p"),
            ticker.get("preMarket"),
        )
        pre_market_change_pct = PolygonClient._first_present(
            pre_market.get("cp"),
            pre_market.get("change_percent"),
            fmh.get("preMarketChangePercent"),
            ticker.get("preMarketChangePercent"),
        )
        after_hours_price = PolygonClient._first_present(
            after_hours.get("p"),
            after_hours.get("price"),
            fmh.get("afterHours"),
            fmh.get("a"),
            ticker.get("afterHours"),
        )
        after_hours_change_pct = PolygonClient._first_present(
            after_hours.get("cp"),
            after_hours.get("change_percent"),
            fmh.get("afterHoursChangePercent"),
            ticker.get("afterHoursChangePercent"),
        )

        day_open = day.get("o")
        day_high = day.get("h")
        day_low = day.get("l")
        day_close = day.get("c")
        day_volume = day.get("v")
        day_vwap = day.get("vw")

        # Index tape (notably VIX / I:VIX) often ships an updating session `day` bar
        # while `lastTrade.p` is absent between official prints. Do not apply this to
        # equities — without a last print, `last_trade_price` must stay None.
        if (
            last_price is None
            and day_close is not None
            and PolygonClient._snapshot_last_trade_may_use_day_close(symbol)
        ):
            try:
                dc = float(day_close)
                if dc == dc and dc > 0:
                    last_price = dc
            except (TypeError, ValueError):
                pass

        change = None
        change_pct = None
        if last_price is not None and prev_close not in (None, 0):
            try:
                pc = float(prev_close)
                lp = float(last_price)
                change = lp - pc
                change_pct = (change / pc) * 100
            except (TypeError, ValueError):
                pass

        should_validate = last_price is not None and last_price > 0
        if should_validate and not PolygonClient._session_day_prices_align_with_last(
            last_price, day_open, day_high, day_low, day_close, day_vwap
        ):
            log.warning(
                "snapshot %s: dropping session OHLC/VWAP (mismatched scale vs last_trade=%s; "
                "threshold ratio=%s)",
                symbol,
                last_price,
                _DAY_VS_LAST_MAX_RATIO,
            )
            day_open = day_high = day_low = day_close = day_volume = day_vwap = None

        name_raw = ticker.get("name") or ticker.get("company_name")
        company_name = str(name_raw).strip() if name_raw else None

        return Snapshot(
            symbol=symbol,
            last_trade_price=last_price,
            last_trade_size=last.get("s"),
            last_quote_bid=quote.get("P"),
            last_quote_ask=quote.get("p"),  # Polygon uses P for bid, p for ask in lastQuote
            day_open=day_open,
            day_high=day_high,
            day_low=day_low,
            day_close=day_close,
            day_volume=day_volume,
            day_vwap=day_vwap,
            prev_close=prev_close,
            change=change,
            change_percent=change_pct,
            pre_market_price=pre_market_price,
            pre_market_change_percent=pre_market_change_pct,
            after_hours_price=after_hours_price,
            after_hours_change_percent=after_hours_change_pct,
            market_status=ticker.get("market"),
            company_name=company_name or None,
            prev_day_volume=float(prev_day_volume) if prev_day_volume is not None else None,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # REST — News
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _news_row_matches_requested_tickers(row: dict, requested_upper: list[str]) -> bool:
        """
        When callers pass explicit tickers, keep only rows whose ``tickers`` list
        intersects that set. Benzinga websocket replay often ignores query ``tickers``;
        Polygon can occasionally return mis-tagged rows — this is defense-in-depth
        so composite/news sentiment never scores unrelated symbols.
        """
        if not requested_upper:
            return True
        req = {str(t).strip().upper() for t in requested_upper if str(t).strip()}
        if not req:
            return True
        raw = row.get("tickers")
        if not isinstance(raw, list):
            return False
        row_syms = {str(t).strip().upper() for t in raw if t is not None and str(t).strip()}
        return bool(row_syms & req)

    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        """Fetch raw market news rows with optional multi-ticker filter.

        Uses Benzinga websocket replay when configured; falls back to Polygon REST.
        """
        if self._benzinga_api_key:
            return await self._get_benzinga_market_news(
                tickers=tickers,
                limit=limit,
                published_utc_gte=published_utc_gte,
            )
        ticker_filter = [str(t).strip().upper() for t in (tickers or []) if str(t).strip()]
        params: dict[str, str] = {"limit": str(limit), "order": order}
        if ticker_filter:
            params["ticker.any_of"] = ",".join(ticker_filter)
        if published_utc_gte is not None:
            params["published_utc.gte"] = (
                published_utc_gte.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            )
        rows_out: list[dict] = []
        path = "/v2/reference/news"
        page_count = 0
        while len(rows_out) < limit:
            data = await self._get(path, params)
            page_count += 1
            rows = data.get("results", []) if isinstance(data, dict) else []
            for row in rows:
                if len(rows_out) >= limit:
                    break
                if isinstance(row, dict):
                    if ticker_filter and not PolygonClient._news_row_matches_requested_tickers(
                        row, ticker_filter
                    ):
                        continue
                    row.setdefault("source", "polygon")
                    rows_out.append(row)
            next_url = data.get("next_url") if isinstance(data, dict) else None
            if not next_url:
                break
            path, params = self._extract_path_and_params(next_url)
            if page_count >= 20:
                break
        return rows_out

    async def _get_benzinga_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        clean = [str(t).strip().upper() for t in (tickers or []) if str(t).strip()]
        query = {"token": self._benzinga_api_key}
        if clean:
            query["tickers"] = ",".join(clean)
        ws_url = f"{self._benzinga_news_ws_url}?{urlencode(query)}"
        out: list[dict] = []
        seen_ids: set[str] = set()
        deadline = asyncio.get_running_loop().time() + 3.0
        try:
            async with websockets.connect(
                ws_url,
                ping_interval=30,
                ping_timeout=20,
                close_timeout=2,
            ) as ws:
                await ws.send("replay")
                while len(out) < max(10, int(limit)):
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=min(1.0, remaining))
                    except TimeoutError:
                        break
                    except websockets.ConnectionClosed:
                        break
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    messages = payload if isinstance(payload, list) else [payload]
                    for msg in messages:
                        row = PolygonClient._parse_benzinga_ws_news_row(msg)
                        if row is None:
                            continue
                        if clean and not PolygonClient._news_row_matches_requested_tickers(row, clean):
                            continue
                        aid = str(row.get("id") or "").strip()
                        if aid and aid in seen_ids:
                            continue
                        if aid:
                            seen_ids.add(aid)
                        if published_utc_gte is not None:
                            ts = self._parse_news_datetime(str(row.get("published_utc") or ""))
                            if ts is None or ts < published_utc_gte.astimezone(timezone.utc):
                                continue
                        out.append(row)
                        if len(out) >= max(10, int(limit)):
                            break
        except Exception as exc:
            log.warning("Benzinga websocket news fetch failed, using Polygon fallback: %s", exc)
            return await self.get_market_news_polygon_fallback(
                tickers=tickers,
                limit=limit,
                published_utc_gte=published_utc_gte,
            )
        out.sort(key=lambda r: str(r.get("published_utc") or ""), reverse=True)
        return out[: max(1, int(limit))]

    async def get_market_news_polygon_fallback(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        """Force Polygon REST news path (used as a fallback from Benzinga websocket)."""
        ticker_filter = [str(t).strip().upper() for t in (tickers or []) if str(t).strip()]
        params: dict[str, str] = {"limit": str(limit), "order": order}
        if ticker_filter:
            params["ticker.any_of"] = ",".join(ticker_filter)
        if published_utc_gte is not None:
            params["published_utc.gte"] = (
                published_utc_gte.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            )
        rows_out: list[dict] = []
        path = "/v2/reference/news"
        page_count = 0
        while len(rows_out) < limit:
            data = await self._get(path, params)
            page_count += 1
            rows = data.get("results", []) if isinstance(data, dict) else []
            for row in rows:
                if len(rows_out) >= limit:
                    break
                if isinstance(row, dict):
                    if ticker_filter and not PolygonClient._news_row_matches_requested_tickers(
                        row, ticker_filter
                    ):
                        continue
                    row.setdefault("source", "polygon")
                    rows_out.append(row)
            next_url = data.get("next_url") if isinstance(data, dict) else None
            if not next_url:
                break
            path, params = self._extract_path_and_params(next_url)
            if page_count >= 20:
                break
        return rows_out

    async def get_news(
        self,
        symbol: Optional[str] = None,
        limit: int = 50,
        order: str = "desc",  # "desc" = newest first
    ) -> list[NewsArticle]:
        """Fetch parsed news articles for existing callers."""
        rows = await self.get_market_news(
            tickers=[symbol] if symbol else None,
            limit=limit,
            order=order,
        )
        articles: list[NewsArticle] = []
        for r in rows:
            try:
                img_raw = r.get("image_url")
                image_url = str(img_raw).strip() if img_raw not in (None, "") else None
                if image_url == "":
                    image_url = None
                src = str(r.get("source") or "").strip()
                if not src:
                    src = str((r.get("publisher") or {}).get("name") or "").strip()
                articles.append(
                    NewsArticle(
                        article_id=r.get("id", ""),
                        published_at=datetime.fromisoformat(r["published_utc"].replace("Z", "+00:00")),
                        title=r.get("title", ""),
                        description=r.get("description"),
                        image_url=image_url,
                        url=r.get("article_url", ""),
                        source=src or None,
                        tickers=r.get("tickers", []),
                        keywords=r.get("keywords", []),
                        company_name=r.get("company_name"),
                        categories=list(r.get("categories") or []),
                    )
                )
            except Exception as exc:
                log.warning("Skipping malformed news article: %s", exc)
        log.debug("get_news(symbol=%s) → %d articles", symbol, len(articles))
        return articles

    @staticmethod
    def _parse_news_datetime(raw: str) -> datetime | None:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            iso = text.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass
        try:
            dt = parsedate_to_datetime(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_benzinga_ws_news_row(msg: object) -> dict | None:
        if not isinstance(msg, dict):
            return None
        if str(msg.get("kind") or "").strip().lower() != "news":
            return None
        data = msg.get("data")
        if not isinstance(data, dict):
            return None
        action = str(data.get("action") or "").strip().lower()
        if action not in {"created", "updated"}:
            return None
        content = data.get("content")
        if not isinstance(content, dict):
            return None
        title = str(content.get("title") or "").strip()
        if not title:
            return None
        article_id = content.get("id") or data.get("id")
        pub_dt = (
            PolygonClient._parse_news_datetime(str(data.get("timestamp") or ""))
            or PolygonClient._parse_news_datetime(str(content.get("updated") or ""))
            or PolygonClient._parse_news_datetime(str(content.get("created") or ""))
            or datetime.now(timezone.utc)
        )
        pub_iso = pub_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        stocks = content.get("stocks")
        tickers: list[str] = []
        if isinstance(stocks, list):
            for row in stocks:
                if not isinstance(row, dict):
                    continue
                sym = str(row.get("name") or "").strip().upper()
                if sym and sym not in tickers:
                    tickers.append(sym)
        tags = content.get("tags")
        keywords: list[str] = []
        if isinstance(tags, list):
            for tag in tags:
                if not isinstance(tag, dict):
                    continue
                nm = str(tag.get("name") or "").strip()
                if nm:
                    keywords.append(nm)
        image_url: str | None = None
        images = content.get("image")
        if isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                raw_img = str(first.get("url") or "").strip()
                if raw_img:
                    image_url = raw_img
        teaser = str(content.get("teaser") or "").strip()
        body = str(content.get("body") or "").strip()
        description = teaser or (body[:500] if body else None)
        categories: list[str] = []
        channels = content.get("channels")
        if isinstance(channels, list):
            for ch in channels:
                if not isinstance(ch, dict):
                    continue
                nm = str(ch.get("name") or "").strip()
                if not nm:
                    continue
                slug = nm.lower().replace("&", " and ").replace("'", "")
                slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
                if slug:
                    categories.append(slug)
        author = str(content.get("author") or "").strip()
        return {
            "id": str(article_id or ""),
            "published_utc": pub_iso,
            "title": title,
            "description": description,
            "article_url": str(content.get("url") or ""),
            "image_url": image_url,
            "tickers": tickers,
            "keywords": keywords,
            "publisher": {"name": "Benzinga"},
            "source": "benzinga",
            "categories": categories,
            "company_name": author or None,
        }

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Options
    # ──────────────────────────────────────────────────────────────────────────

    async def get_options_chain(
        self,
        underlying:       str,
        expiration_date:  Optional[str] = None,   # YYYY-MM-DD
        strike_price_gte: Optional[float] = None,
        strike_price_lte: Optional[float] = None,
        option_type:      Optional[str] = None,   # "call" | "put"
        limit:            int = 250,
    ) -> list[OptionContract]:
        """
        Fetch options chain with Greeks.

        Note: Polygon Options Starter provides 15-min delayed data.
        """
        params: dict = {"limit": str(limit), "sort": "expiration_date"}
        if expiration_date:
            params["expiration_date"] = expiration_date
        if strike_price_gte is not None:
            params["strike_price.gte"] = str(strike_price_gte)
        if strike_price_lte is not None:
            params["strike_price.lte"] = str(strike_price_lte)
        if option_type:
            params["contract_type"] = option_type

        data = await self._get(f"/v3/snapshot/options/{underlying}", params)

        contracts: list[OptionContract] = []
        for r in data.get("results", []):
            d = r.get("details", {}) or {}
            g = r.get("greeks",  {}) or {}
            last = r.get("last_quote", {}) or {}
            day  = r.get("day",        {}) or {}

            try:
                expiry_str = d.get("expiration_date", "")
                expiry_dt = (
                    datetime.fromisoformat(expiry_str)
                    if expiry_str
                    else datetime.now(tz=timezone.utc)
                )
                contracts.append(OptionContract(
                    symbol=d.get("ticker", ""),
                    underlying=underlying,
                    expiration=expiry_dt,
                    strike=d.get("strike_price", 0.0),
                    option_type=d.get("contract_type", ""),
                    last_price=r.get("last_trade", {}).get("price"),
                    bid=last.get("bid"),
                    ask=last.get("ask"),
                    volume=day.get("volume"),
                    open_interest=r.get("open_interest"),
                    implied_volatility=r.get("implied_volatility"),
                    delta=g.get("delta"),
                    gamma=g.get("gamma"),
                    theta=g.get("theta"),
                    vega=g.get("vega"),
                    rho=g.get("rho"),
                ))
            except Exception as exc:
                log.warning("Skipping malformed option contract: %s", exc)

        log.debug(
            "get_options_chain(%s) → %d contracts", underlying, len(contracts)
        )
        return contracts

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Market Status
    # ──────────────────────────────────────────────────────────────────────────

    async def get_market_status(self) -> MarketStatus:
        """Return current market open/closed status for all asset classes."""
        data = await self._get("/v1/marketstatus/now")
        return MarketStatus(
            market=data.get("market", "stocks"),
            server_time=datetime.fromisoformat(
                data["serverTime"].replace("Z", "+00:00")
            ) if data.get("serverTime") else datetime.now(tz=timezone.utc),
            exchanges=data.get("exchanges", {}),
            currencies=data.get("currencies", {}),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Previous Close
    # ──────────────────────────────────────────────────────────────────────────

    async def get_previous_close(self, symbol: str) -> Bar | None:
        """Fetch the previous day's OHLCV bar (used for gap calculations)."""
        data = await self._get(f"/v2/aggs/ticker/{symbol}/prev", {"adjusted": "true"})
        results = data.get("results") or []
        if not results:
            return None
        r = results[0]
        return Bar(
            symbol=symbol,
            timestamp=self._ts_ms_to_dt(r["t"]),
            timeframe=Timeframe.DAY_1,
            open=r["o"],
            high=r["h"],
            low=r["l"],
            close=r["c"],
            volume=r["v"],
            vwap=r.get("vw"),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # REST — Ticker Details
    # ──────────────────────────────────────────────────────────────────────────

    async def get_ticker_details(self, symbol: str) -> dict:
        """
        Fetch reference data for a ticker (name, sector, market cap, etc.)
        Returns raw dict — callers may need different fields.
        """
        data = await self._get(f"/v3/reference/tickers/{symbol}")
        return data.get("results", {})

    async def search_reference_tickers(self, query: str, *, limit: int = 15) -> list[dict[str, str]]:
        """
        Polygon ``GET /v3/reference/tickers`` — match ticker or company name (for symbol pickers).
        """
        q = (query or "").strip()
        if len(q) < 2:
            return []
        lim = max(1, min(int(limit), 25))
        params = {
            "search": q,
            "active": "true",
            "limit": str(lim),
            "market": "stocks",
        }
        data = await self._get("/v3/reference/tickers", params)
        rows_out: list[dict[str, str]] = []
        for row in data.get("results", []) or []:
            if not isinstance(row, dict):
                continue
            t = str(row.get("ticker") or "").strip().upper()
            if not t or len(t) > 12:
                continue
            name = str(row.get("name") or "").strip()
            rows_out.append({"ticker": t, "name": name})
            if len(rows_out) >= lim:
                break
        return rows_out

    async def get_earnings_calendar(
        self,
        symbols: list[str],
        from_date: date | str,
        to_date: date | str,
    ) -> list[EarningsEvent]:
        """
        Fetch earnings events from Polygon's Benzinga partner endpoint.

        Uses Redis cache for 1 hour by (symbols, from_date, to_date).
        """
        normalized_symbols = sorted({s.strip().upper() for s in symbols if s and s.strip()})
        if not normalized_symbols:
            return []
        from_iso = from_date.isoformat() if isinstance(from_date, date) else str(from_date)
        to_iso = to_date.isoformat() if isinstance(to_date, date) else str(to_date)
        cache_key = f"stocvest:earnings:v2:{','.join(normalized_symbols)}:{from_iso}:{to_iso}"
        symbol_set = set(normalized_symbols)
        from_bound = date.fromisoformat(from_iso)
        to_bound = date.fromisoformat(to_iso)

        r = get_sync_redis()
        if r is not None:
            try:
                cached = r.get(cache_key)
                if cached:
                    rows = json.loads(cached)
                    if isinstance(rows, list):
                        return [EarningsEvent.model_validate(row) for row in rows]
            except Exception:
                pass

        params: dict[str, str] = {
            "ticker.any_of": ",".join(normalized_symbols),
            "date.gte": from_iso,
            "date.lte": to_iso,
            "limit": "1000",
            "sort": "date.asc",
        }
        path = "/benzinga/v1/earnings"
        events: list[EarningsEvent] = []
        seen: set[tuple[str, str, str | None, int | None]] = set()
        page_idx = 0

        while True:
            data = await self._get(path, params)
            log.debug(
                "Polygon Benzinga earnings raw (page=%s): %s",
                page_idx,
                json.dumps(data, default=str)[:8192],
            )

            for row in data.get("results", []) or []:
                if not isinstance(row, dict):
                    continue
                ticker = str(row.get("ticker") or "").strip().upper()
                if not ticker or ticker not in symbol_set:
                    continue
                report_date_raw = row.get("date")
                if not report_date_raw:
                    continue
                try:
                    report_dt = date.fromisoformat(str(report_date_raw))
                except ValueError:
                    continue
                if report_dt < from_bound or report_dt > to_bound:
                    continue

                fiscal_period = row.get("fiscal_period")
                fiscal_year = row.get("fiscal_year")
                dedupe_key = (
                    ticker,
                    report_dt.isoformat(),
                    str(fiscal_period) if fiscal_period is not None else None,
                    int(fiscal_year) if fiscal_year is not None else None,
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                events.append(
                    EarningsEvent(
                        symbol=ticker,
                        company_name=str(row.get("company_name") or ticker),
                        report_date=report_dt,
                        report_time=self._report_time_from_benzinga(row.get("time")),
                        estimated_eps=self._safe_float(row.get("estimated_eps")),
                        actual_eps=self._safe_float(row.get("actual_eps")),
                        surprise_percent=self._safe_float(row.get("eps_surprise_percent")),
                        market_cap=None,
                    )
                )

            next_url = data.get("next_url")
            if not next_url:
                break
            path, params = self._extract_path_and_params(next_url)
            page_idx += 1
            if page_idx >= 20:
                break

        events.sort(key=lambda e: (e.report_date, e.symbol))
        if r is not None:
            try:
                r.setex(cache_key, 3600, json.dumps([e.model_dump(mode="json") for e in events], default=str))
            except Exception:
                pass
        return events

    async def get_economic_calendar_for_day(self, on_date: date) -> list[EconomicCalendarEvent]:
        """
        Macro calendar rows for a single session date (Benzinga partner economics).

        Returns an empty list if the endpoint is unavailable for the API tier or on error.
        """
        iso = on_date.isoformat()
        try:
            data = await self._get(
                "/benzinga/v1/economics",
                {
                    "date.gte": iso,
                    "date.lte": iso,
                    "limit": "100",
                    "sort": "time.asc",
                },
            )
        except (PolygonError, Exception) as exc:
            log.debug("get_economic_calendar_for_day: %s", exc)
            return []
        out: list[EconomicCalendarEvent] = []
        for r in data.get("results") or []:
            if not isinstance(r, dict):
                continue
            try:
                raw_imp = str(r.get("importance") or r.get("impact") or "").lower()
                if raw_imp in ("high", "1", "3"):
                    imp = "high"
                elif raw_imp in ("medium", "2", "med"):
                    imp = "medium"
                else:
                    imp = "low"
                t = str(r.get("time") or r.get("event_time") or "")
                nm = str(r.get("event_name") or r.get("title") or r.get("description") or "Economic indicator")
                out.append(EconomicCalendarEvent(time_et=t, event_name=nm, impact=imp, event_date=on_date))
            except Exception:
                continue
        rank = {"high": 0, "medium": 1, "low": 2}
        out.sort(key=lambda e: (rank.get(e.impact, 3), e.time_et))
        return out[:10]

    async def get_economic_calendar_range(self, start: date, end: date) -> list[EconomicCalendarEvent]:
        """Macro calendar rows between ``start`` and ``end`` (inclusive), best-effort."""
        if end < start:
            return []
        try:
            data = await self._get(
                "/benzinga/v1/economics",
                {
                    "date.gte": start.isoformat(),
                    "date.lte": end.isoformat(),
                    "limit": "500",
                    "sort": "date.asc",
                },
            )
        except (PolygonError, Exception) as exc:
            log.debug("get_economic_calendar_range: %s", exc)
            return []
        out: list[EconomicCalendarEvent] = []
        for r in data.get("results") or []:
            if not isinstance(r, dict):
                continue
            try:
                raw_imp = str(r.get("importance") or r.get("impact") or "").lower()
                if raw_imp in ("high", "1", "3"):
                    imp = "high"
                elif raw_imp in ("medium", "2", "med"):
                    imp = "medium"
                else:
                    imp = "low"
                t = str(r.get("time") or r.get("event_time") or "")
                nm = str(r.get("event_name") or r.get("title") or r.get("description") or "Economic indicator")
                ev_dt: date | None = None
                raw_d = r.get("date") or r.get("event_date")
                if isinstance(raw_d, str) and len(raw_d) >= 10:
                    try:
                        ev_dt = date.fromisoformat(raw_d[:10])
                    except ValueError:
                        ev_dt = None
                out.append(EconomicCalendarEvent(time_et=t, event_name=nm, impact=imp, event_date=ev_dt))
            except Exception:
                continue
        rank = {"high": 0, "medium": 1, "low": 2}
        out.sort(key=lambda e: (e.event_date or date.min, rank.get(e.impact, 3), e.time_et))
        return out[:50]

    async def get_polygon_econ_events(self, start: date, end: date) -> list[EconomicCalendarEvent]:
        """Alias for :meth:`get_economic_calendar_range` — economics feed for macro enrichment."""
        return await self.get_economic_calendar_range(start, end)

    # ──────────────────────────────────────────────────────────────────────────
    # WebSocket — Real-time streaming
    # ──────────────────────────────────────────────────────────────────────────

    async def stream_quotes(
        self,
        symbols: list[str],
        on_quote: Callable[[Quote], None],
    ) -> None:
        """
        Stream real-time NBBO quotes for a list of symbols.

        This coroutine runs until cancelled.  Call on_quote for every quote received.

        Usage:
            async def handle_quote(q: Quote):
                print(q.symbol, q.bid_price, q.ask_price)

            await client.stream_quotes(["AAPL", "TSLA"], handle_quote)
        """
        url = f"{_POLYGON_WS_BASE}/stocks"
        subs = [f"Q.{sym}" for sym in symbols]
        await self._ws_subscribe(url, subs, self._parse_ws_quote, on_quote)

    async def stream_trades(
        self,
        symbols: list[str],
        on_trade: Callable[[Trade], None],
    ) -> None:
        """
        Stream real-time trades (last sale) for a list of symbols.

        This coroutine runs until cancelled.
        """
        url = f"{_POLYGON_WS_BASE}/stocks"
        subs = [f"T.{sym}" for sym in symbols]
        await self._ws_subscribe(url, subs, self._parse_ws_trade, on_trade)

    async def stream_minute_bars(
        self,
        symbols: list[str],
        on_bar: Callable[[Bar], None],
    ) -> None:
        """
        Stream real-time 1-minute aggregate bars.

        Bars are emitted at the END of each minute (Polygon "A.*" channel).
        This coroutine runs until cancelled.
        """
        url = f"{_POLYGON_WS_BASE}/stocks"
        subs = [f"A.{sym}" for sym in symbols]
        await self._ws_subscribe(url, subs, self._parse_ws_bar, on_bar)

    async def _ws_subscribe(
        self,
        url:      str,
        channels: list[str],
        parser:   Callable[[dict], object | None],
        callback: Callable[[object], None] | Callable[[object], Awaitable[None]],
    ) -> None:
        """
        Internal: connect to a Polygon WebSocket, authenticate, subscribe,
        and dispatch parsed messages to callback.
        """
        log.info("WebSocket connecting to %s (channels: %s)", url, channels)
        async for ws in websockets.connect(url, ping_interval=30, ping_timeout=10):
            try:
                # Auth
                await ws.send(json.dumps({"action": "auth", "params": self._api_key}))
                auth_resp = json.loads(await ws.recv())
                if not any(m.get("status") == "auth_success" for m in auth_resp):
                    raise PolygonError(f"WebSocket auth failed: {auth_resp}")
                log.info("WebSocket authenticated")

                # Subscribe
                await ws.send(json.dumps({"action": "subscribe", "params": ",".join(channels)}))
                log.info("Subscribed to %d channels", len(channels))

                # Dispatch loop
                async for raw in ws:
                    try:
                        messages = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        log.warning("WebSocket JSON decode error: %s", exc)
                        continue

                    for msg in messages:
                        obj = parser(msg)
                        if obj is not None:
                            try:
                                result = callback(obj)
                                if asyncio.iscoroutine(result):
                                    await result
                            except Exception as exc:
                                log.warning("WebSocket callback error: %s", exc)

            except websockets.ConnectionClosed as exc:
                delay = min(self._retry_backoff_seconds * 2, 5.0)
                log.warning("WebSocket closed (%s), reconnecting in %.1fs", exc, delay)
                await asyncio.sleep(delay)
                continue
            except Exception as exc:
                delay = min(self._retry_backoff_seconds * 2, 5.0)
                log.warning("WebSocket stream error (%s), reconnecting in %.1fs", exc, delay)
                await asyncio.sleep(delay)
                continue

    # ── WebSocket parsers ─────────────────────────────────────────────────────

    def _parse_ws_quote(self, msg: dict) -> Quote | None:
        if msg.get("ev") != "Q":
            return None
        try:
            return Quote(
                symbol=msg["sym"],
                timestamp=self._ts_ns_to_dt(msg["t"]),
                bid_price=msg.get("bp", 0.0),
                bid_size=msg.get("bs", 0),
                ask_price=msg.get("ap", 0.0),
                ask_size=msg.get("as", 0),
                bid_exchange=str(msg.get("bx", "")),
                ask_exchange=str(msg.get("ax", "")),
            )
        except Exception as exc:
            log.debug("Bad quote message: %s — %s", exc, msg)
            return None

    def _parse_ws_trade(self, msg: dict) -> Trade | None:
        if msg.get("ev") != "T":
            return None
        try:
            return Trade(
                symbol=msg["sym"],
                timestamp=self._ts_ns_to_dt(msg["t"]),
                price=msg.get("p", 0.0),
                size=msg.get("s", 0),
                exchange=str(msg.get("x", "")),
                conditions=msg.get("c", []),
            )
        except Exception as exc:
            log.debug("Bad trade message: %s — %s", exc, msg)
            return None

    def _parse_ws_bar(self, msg: dict) -> Bar | None:
        if msg.get("ev") != "A":
            return None
        try:
            return Bar(
                symbol=msg["sym"],
                timestamp=self._ts_ms_to_dt(msg["s"]),  # "s" = start of bar
                timeframe=Timeframe.MIN_1,
                open=msg.get("o", 0.0),
                high=msg.get("h", 0.0),
                low=msg.get("l", 0.0),
                close=msg.get("c", 0.0),
                volume=msg.get("v", 0.0),  # minute bar volume
                vwap=msg.get("vw"),
            )
        except Exception as exc:
            log.debug("Bad bar message: %s — %s", exc, msg)
            return None

    @staticmethod
    def _first_present(*values):
        for value in values:
            if value is not None:
                return value
        return None

    @staticmethod
    def _extract_path_and_params(next_url: str) -> tuple[str, dict[str, str]]:
        url = httpx.URL(next_url)
        params = {key: value for key, value in url.params.multi_items()}
        return url.path, params

    @staticmethod
    def _safe_float(v: object) -> float | None:
        try:
            if v is None:
                return None
            return float(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_report_time(raw: object) -> str:
        text = str(raw or "").strip().lower()
        if text in {"bmo", "before", "before_open", "before market", "before_market"}:
            return "before_market"
        if text in {"amc", "after", "after_close", "after market", "after_market"}:
            return "after_market"
        if text in {"dmh", "during", "during_market", "during market"}:
            return "during_market"
        return "unknown"

    @classmethod
    def _report_time_from_benzinga(cls, raw: object) -> str:
        """
        Map Benzinga `time` (24h HH:MM:SS in US/Eastern per Polygon docs) to report_time bucket.
        """
        text = str(raw or "").strip()
        if not text:
            return "unknown"
        keyword = cls._normalize_report_time(text)
        if keyword != "unknown":
            return keyword
        parts = text.split(":")
        if len(parts) < 2:
            return "unknown"
        try:
            hour = int(parts[0])
            minute = int(parts[1])
            second = int(parts[2]) if len(parts) > 2 else 0
        except ValueError:
            return "unknown"
        if hour == 0 and minute == 0 and second == 0:
            return "unknown"
        if hour >= 16:
            return "after_market"
        if hour < 9 or (hour == 9 and minute < 30):
            return "before_market"
        return "during_market"


def benzinga_market_dict_to_news_article(row: dict) -> NewsArticle | None:
    """Normalize Benzinga websocket/REST-shaped dict to :class:`NewsArticle`."""
    try:
        pub = str(row.get("published_utc") or "").replace("Z", "+00:00")
        img_raw = row.get("image_url")
        image_url = str(img_raw).strip() if img_raw not in (None, "") else None
        if image_url == "":
            image_url = None
        cats = row.get("categories")
        if not isinstance(cats, list):
            cats = []
        return NewsArticle(
            article_id=str(row.get("id") or ""),
            published_at=datetime.fromisoformat(pub),
            title=str(row.get("title") or ""),
            description=row.get("description"),
            image_url=image_url,
            url=str(row.get("article_url") or ""),
            source=str(row.get("source") or "benzinga"),
            tickers=list(row.get("tickers") or []),
            keywords=list(row.get("keywords") or []),
            company_name=row.get("company_name"),
            categories=[str(c) for c in cats if str(c).strip()],
        )
    except Exception as exc:
        log.debug("benzinga_market_dict_to_news_article skip: %s", exc)
        return None


class BenzingaNewsStream:
    """Long-running Benzinga news websocket (replay + live); reconnect with backoff."""

    def __init__(
        self,
        token: str,
        ws_base: str = _BENZINGA_NEWS_WS_BASE,
        *,
        stop_event: asyncio.Event | None = None,
        max_auth_failures: int = 3,
    ) -> None:
        self._token = token.strip()
        self._ws_base = ws_base.rstrip("/")
        self._stop = stop_event or asyncio.Event()
        self._backoff_seconds = 1.0
        self._max_auth_failures = max(1, int(max_auth_failures))
        self._auth_failures = 0

    def stop(self) -> None:
        self._stop.set()

    @staticmethod
    def _is_auth_failure(exc: Exception) -> bool:
        response = getattr(exc, "response", None)
        status_code = getattr(response, "status_code", None)
        if status_code == 401:
            return True
        text = str(exc).lower()
        return "auth_failed" in text or "status_code=401" in text

    async def run(self, on_article: Callable[[NewsArticle], Union[Awaitable[None], None]]) -> None:
        if not self._token:
            log.error("BenzingaNewsStream: missing API token")
            return
        query = urlencode({"token": self._token})
        ws_url = f"{self._ws_base}?{query}"
        while not self._stop.is_set():
            try:
                log.info("Benzinga websocket connecting")
                async with websockets.connect(
                    ws_url,
                    ping_interval=20,
                    ping_timeout=25,
                    close_timeout=5,
                ) as ws:
                    await ws.send("replay")
                    self._backoff_seconds = 1.0
                    while not self._stop.is_set():
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=120.0)
                        except TimeoutError:
                            try:
                                await ws.send("ping")
                            except Exception:
                                break
                            continue
                        try:
                            payload = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        messages = payload if isinstance(payload, list) else [payload]
                        for msg in messages:
                            row = PolygonClient._parse_benzinga_ws_news_row(msg)
                            if row is None:
                                continue
                            art = benzinga_market_dict_to_news_article(row)
                            if art is None:
                                continue
                            out = on_article(art)
                            if asyncio.iscoroutine(out):
                                await out
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._is_auth_failure(exc):
                    self._auth_failures += 1
                    if self._auth_failures >= self._max_auth_failures:
                        log.error(
                            "Benzinga websocket auth failed %d times; disabling Benzinga stream "
                            "until worker restart or key update",
                            self._auth_failures,
                        )
                        await self._stop.wait()
                        break
                else:
                    self._auth_failures = 0
                log.warning(
                    "Benzinga websocket error (%s); reconnecting in %.1fs",
                    exc,
                    min(self._backoff_seconds, 60.0),
                )
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=min(self._backoff_seconds, 60.0))
                    break
                except TimeoutError:
                    pass
                self._backoff_seconds = min(self._backoff_seconds * 2, 60.0)
