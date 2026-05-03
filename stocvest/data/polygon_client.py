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
from datetime import date, datetime, timezone
from typing import Awaitable, Callable, Optional

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

# Polygon occasionally returns a `day` OHLC/VWAP block on a different price scale than
# `lastTrade.p` (bad aggregate / stale session). Only compare when `last_trade_price` is a
# positive number; otherwise keep the session bar. Ratio uses a loose bound to avoid
# false positives on valid tape (2.5× was too tight in production).
_DAY_VS_LAST_MAX_RATIO = 5.0


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
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        if not api_key:
            raise ValueError("POLYGON_API_KEY is required")
        self._api_key = api_key
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
            from_date:  Start date (inclusive).  Defaults to 200 bars back.
            to_date:    End date (inclusive).    Defaults to today.
            limit:      Max bars to return (Polygon cap: 50,000).
            adjusted:   True = split/dividend adjusted prices.

        Returns:
            List of Bar objects, oldest-first.
        """
        multiplier, timespan = _TIMEFRAME_MAP[timeframe]

        # Default date range
        if to_date is None:
            to_date = date.today().isoformat()
        if from_date is None:
            from_date = "2000-01-01"  # Polygon ignores if limit is set

        params = {
            "adjusted": str(adjusted).lower(),
            "sort":     "asc",
            "limit":    str(limit),
        }

        path = f"/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from_date}/{to_date}"
        data = await self._get(path, params)

        results = data.get("results") or []
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
        log.debug("get_bars(%s, %s) → %d bars", symbol, timeframe.value, len(bars))
        return bars

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
        last_price = last.get("p")
        change = None
        change_pct = None
        if last_price is not None and prev_close not in (None, 0):
            change = last_price - prev_close
            change_pct = (change / prev_close) * 100

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

    async def get_news(
        self,
        symbol:   Optional[str] = None,
        limit:    int = 50,
        order:    str = "desc",  # "desc" = newest first
    ) -> list[NewsArticle]:
        """
        Fetch news articles.

        Args:
            symbol:  Filter by ticker (optional — omit for all market news).
            limit:   Max articles (Polygon max: 1000).
            order:   "desc" (newest first) or "asc".
        """
        params: dict = {"limit": str(limit), "order": order}
        if symbol:
            params["ticker"] = symbol
        articles: list[NewsArticle] = []
        path = "/v2/reference/news"
        page_count = 0

        while len(articles) < limit:
            data = await self._get(path, params)
            page_count += 1

            for r in data.get("results", []):
                if len(articles) >= limit:
                    break
                try:
                    img_raw = r.get("image_url")
                    image_url = str(img_raw).strip() if img_raw not in (None, "") else None
                    if image_url == "":
                        image_url = None
                    articles.append(NewsArticle(
                        article_id=r.get("id", ""),
                        published_at=datetime.fromisoformat(
                            r["published_utc"].replace("Z", "+00:00")
                        ),
                        title=r.get("title", ""),
                        description=r.get("description"),
                        image_url=image_url,
                        url=r.get("article_url", ""),
                        source=r.get("publisher", {}).get("name"),
                        tickers=r.get("tickers", []),
                        keywords=r.get("keywords", []),
                    ))
                except Exception as exc:
                    log.warning("Skipping malformed news article: %s", exc)

            next_url = data.get("next_url")
            if not next_url:
                break
            path, params = self._extract_path_and_params(next_url)
            if page_count >= 20:
                # Safety cap to prevent infinite pagination loops if API misbehaves.
                break

        log.debug("get_news(symbol=%s) → %d articles", symbol, len(articles))
        return articles

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
                out.append(EconomicCalendarEvent(time_et=t, event_name=nm, impact=imp))
            except Exception:
                continue
        rank = {"high": 0, "medium": 1, "low": 2}
        out.sort(key=lambda e: (rank.get(e.impact, 3), e.time_et))
        return out[:10]

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
