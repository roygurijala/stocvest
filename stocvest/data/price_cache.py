"""
Redis-backed daily price history for laggard peer detection (Chunk 3).

Warms ~25 trading days of OHLCV per symbol (registry + watchlists). Dynamic
top movers are NOT cached here — see dynamic_cluster_detector (Chunk 4B).
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Protocol

from stocvest.data.models import Bar, Timeframe
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

BAR_LOOKBACK = 25
CACHE_TTL_SECONDS = 25 * 3600
_CLOSE_HISTORY_LEN = 10


def _sym_key(symbol: str) -> str:
    return (symbol or "").strip().upper()


def _key(symbol: str, suffix: str) -> str:
    return f"stocvest:price:{_sym_key(symbol)}:{suffix}"


def compute_5d_change_pct(closes: list[float]) -> float | None:
    """(last close vs close 5 sessions back) * 100. Needs at least 6 closes."""
    if len(closes) < 6:
        return None
    prev = closes[-6]
    last = closes[-1]
    if prev == 0:
        return None
    return (last - prev) / prev * 100.0


def compute_vol_avg_20d(volumes: list[float]) -> float | None:
    if not volumes:
        return None
    tail = volumes[-20:]
    return sum(tail) / len(tail)


def compute_1d_change_pct(closes: list[float]) -> float | None:
    if len(closes) < 2:
        return None
    prev = closes[-2]
    last = closes[-1]
    if prev == 0:
        return None
    return (last - prev) / prev * 100.0


class _PolygonBarsClient(Protocol):
    async def get_bars(
        self,
        symbol: str,
        timeframe: Timeframe,
        *,
        limit: int = 200,
    ) -> list[Bar]: ...


class PriceCache:
    """Read/write laggard price metrics in Redis (sync client, async warm)."""

    def __init__(self, *, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
        self._ttl = max(60, int(ttl_seconds))

    def is_cached(self, symbol: str) -> bool:
        r = get_sync_redis()
        if r is None:
            return False
        try:
            return bool(r.get(_key(symbol, "updated_at")))
        except Exception:
            return False

    def get_5d_change(self, symbol: str) -> float | None:
        return self._get_float(symbol, "5d_change")

    def get_vol_avg_20d(self, symbol: str) -> float | None:
        return self._get_float(symbol, "vol_avg_20d")

    def get_volume_ratio(self, symbol: str) -> float:
        """Today's volume vs 20d average; 1.0 when not cached."""
        raw = self._get_float(symbol, "vol_ratio")
        return raw if raw is not None else 1.0

    def list_cached_symbols(self) -> list[str]:
        """Symbols with a warmed ``updated_at`` key (best-effort Redis scan)."""
        r = get_sync_redis()
        if r is None:
            return []
        prefix = "stocvest:price:"
        suffix = ":updated_at"
        out: list[str] = []
        seen: set[str] = set()
        try:
            for key in r.scan_iter(match=f"{prefix}*{suffix}", count=200):
                k = key.decode() if isinstance(key, bytes) else str(key)
                if not k.startswith(prefix) or not k.endswith(suffix):
                    continue
                sym = k[len(prefix) : -len(suffix)].upper()
                if sym and sym not in seen:
                    seen.add(sym)
                    out.append(sym)
        except Exception as exc:
            _LOG.warning("price_cache_list_symbols_failed err=%s", type(exc).__name__)
        return sorted(out)

    def get_1d_change(self, symbol: str) -> float | None:
        history = self.get_close_history(symbol, n=2)
        if not history or len(history) < 2:
            return None
        return compute_1d_change_pct(history)

    def get_close_history(self, symbol: str, n: int = 10) -> list[float] | None:
        r = get_sync_redis()
        if r is None:
            return None
        try:
            raw = r.get(_key(symbol, "close_history"))
            if not raw:
                return None
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                return None
            out = [float(x) for x in parsed if isinstance(x, (int, float))]
            if n <= 0:
                return out
            return out[-n:]
        except (TypeError, ValueError, json.JSONDecodeError):
            return None

    def _get_float(self, symbol: str, suffix: str) -> float | None:
        r = get_sync_redis()
        if r is None:
            return None
        try:
            raw = r.get(_key(symbol, suffix))
            if raw is None or raw == "":
                return None
            return float(raw)
        except (TypeError, ValueError):
            return None

    async def warm(
        self,
        symbols: list[str],
        polygon_client: _PolygonBarsClient,
        concurrency: int = 10,
    ) -> dict[str, int]:
        """
        Fetch daily bars and store metrics. Never raises.

        Returns {"cached": N, "errors": N}.
        """
        uniq = list(dict.fromkeys(_sym_key(s) for s in symbols if _sym_key(s)))
        if not uniq:
            return {"cached": 0, "errors": 0}

        sem = asyncio.Semaphore(max(1, int(concurrency)))
        cached = 0
        errors = 0

        async def _one(sym: str) -> bool:
            async with sem:
                try:
                    return await self._fetch_and_cache_symbol(sym, polygon_client)
                except Exception as exc:
                    _LOG.warning("price_cache_symbol_failed symbol=%s err=%s", sym, type(exc).__name__)
                    return False

        results = await asyncio.gather(*[_one(s) for s in uniq], return_exceptions=True)
        for res in results:
            if res is True:
                cached += 1
            else:
                errors += 1
        return {"cached": cached, "errors": errors}

    async def _fetch_and_cache_symbol(
        self,
        symbol: str,
        polygon_client: _PolygonBarsClient,
    ) -> bool:
        sym = _sym_key(symbol)
        bars = await polygon_client.get_bars(sym, Timeframe.DAY_1, limit=BAR_LOOKBACK)
        if not bars:
            _LOG.warning("price_cache_no_bars symbol=%s", sym)
            return False

        closes = [float(b.close) for b in bars]
        volumes = [float(b.volume) for b in bars]
        change_5d = compute_5d_change_pct(closes)
        vol_avg = compute_vol_avg_20d(volumes)
        history = closes[-_CLOSE_HISTORY_LEN:]
        vol_ratio = 1.0
        if vol_avg and vol_avg > 0 and volumes:
            vol_ratio = float(volumes[-1]) / vol_avg

        r = get_sync_redis()
        if r is None:
            _LOG.warning("price_cache_redis_unavailable symbol=%s", sym)
            return False

        try:
            pipe = r.pipeline()
            if change_5d is not None:
                pipe.setex(_key(sym, "5d_change"), self._ttl, str(change_5d))
            if vol_avg is not None:
                pipe.setex(_key(sym, "vol_avg_20d"), self._ttl, str(vol_avg))
            pipe.setex(_key(sym, "vol_ratio"), self._ttl, str(vol_ratio))
            pipe.setex(_key(sym, "close_history"), self._ttl, json.dumps(history))
            pipe.setex(
                _key(sym, "updated_at"),
                self._ttl,
                datetime.now(timezone.utc).isoformat(),
            )
            pipe.execute()
            return True
        except Exception as exc:
            _LOG.warning("price_cache_redis_write_failed symbol=%s err=%s", sym, type(exc).__name__)
            return False
