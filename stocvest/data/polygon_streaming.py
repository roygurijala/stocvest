"""Polygon WebSocket streaming mixin.

Split out of ``polygon_client.py``. Holds the real-time quote/trade/bar
streaming methods; mixed into ``PolygonClient`` so call sites are unchanged.
"""

from __future__ import annotations

import asyncio
import json
from typing import Awaitable, Callable

import websockets

from stocvest.data.models import Bar, Quote, Timeframe, Trade
from stocvest.data.polygon_client import PolygonError, _POLYGON_WS_BASE
from stocvest.utils.logging import get_logger

log = get_logger(__name__)


class _StreamingMixin:
    """Real-time WebSocket streaming methods for :class:`PolygonClient`."""

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
