"""
Polygon.io data client — covers everything STOCVEST needs:

  REST (httpx):
    • Aggregate bars (any timeframe, any multiplier)
    • Snapshot API (pre-market gaps, intraday scanner)
    • News (with pagination)
    • Options chain + Greeks
    • Market status / calendar

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
from typing import AsyncIterator, Callable, Optional

import httpx
import websockets
import json

from stocvest.data.models import (
    AssetType,
    Bar,
    MarketStatus,
    NewsArticle,
    OptionContract,
    Quote,
    Snapshot,
    Timeframe,
    Trade,
)
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

_POLYGON_REST_BASE = "https://api.polygon.io"
_POLYGON_WS_BASE   = "wss://socket.polygon.io"


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

    def __init__(self, api_key: str, timeout: float = 30.0) -> None:
        if not api_key:
            raise ValueError("POLYGON_API_KEY is required")
        self._api_key = api_key
        self._timeout = timeout
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
        resp = await self._http.get(path, params=params)
        if resp.status_code != 200:
            raise PolygonError(f"Polygon {resp.status_code} on {path}: {resp.text[:200]}")
        data = resp.json()
        status = data.get("status", "")
        if status not in ("OK", "DELAYED", ""):
            raise PolygonError(f"Polygon status={status} on {path}: {data.get('error', '')}")
        return data

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
    def _parse_snapshot(symbol: str, ticker: dict) -> Snapshot:
        day   = ticker.get("day",       {}) or {}
        prev  = ticker.get("prevDay",   {}) or {}
        last  = ticker.get("lastTrade", {}) or {}
        quote = ticker.get("lastQuote", {}) or {}
        fmh   = ticker.get("fmh",       {}) or {}  # pre-market / after-hours from some endpoints

        prev_close = prev.get("c")
        last_price = last.get("p")
        change = None
        change_pct = None
        if last_price is not None and prev_close:
            change = last_price - prev_close
            change_pct = (change / prev_close) * 100

        return Snapshot(
            symbol=symbol,
            last_trade_price=last_price,
            last_trade_size=last.get("s"),
            last_quote_bid=quote.get("P"),
            last_quote_ask=quote.get("P"),  # Polygon uses P for bid, p for ask in lastQuote
            day_open=day.get("o"),
            day_high=day.get("h"),
            day_low=day.get("l"),
            day_close=day.get("c"),
            day_volume=day.get("v"),
            day_vwap=day.get("vw"),
            prev_close=prev_close,
            change=change,
            change_percent=change_pct,
            market_status=ticker.get("market"),
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
        data = await self._get("/v2/reference/news", params)

        articles: list[NewsArticle] = []
        for r in data.get("results", []):
            try:
                articles.append(NewsArticle(
                    article_id=r.get("id", ""),
                    published_at=datetime.fromisoformat(
                        r["published_utc"].replace("Z", "+00:00")
                    ),
                    title=r.get("title", ""),
                    description=r.get("description"),
                    url=r.get("article_url", ""),
                    source=r.get("publisher", {}).get("name"),
                    tickers=r.get("tickers", []),
                    keywords=r.get("keywords", []),
                ))
            except Exception as exc:
                log.warning("Skipping malformed news article: %s", exc)

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
        callback: Callable[[object], None],
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
                    messages = json.loads(raw)
                    for msg in messages:
                        obj = parser(msg)
                        if obj is not None:
                            callback(obj)

            except websockets.ConnectionClosed as exc:
                log.warning("WebSocket closed (%s), reconnecting…", exc)
                await asyncio.sleep(1)
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
                volume=msg.get("av", 0.0),  # accumulated volume
                vwap=msg.get("vw"),
            )
        except Exception as exc:
            log.debug("Bad bar message: %s — %s", exc, msg)
            return None
