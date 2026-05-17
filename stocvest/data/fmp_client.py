"""Financial Modeling Prep (FMP) — fundamentals context only (not signal layers)."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import httpx

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

FMP_STABLE_BASE = "https://financialmodelingprep.com/stable"
TrendDirection = Literal["growing", "flat", "declining", "unknown"]

_CACHE_TTL_SEC = 24 * 60 * 60


def _api_key() -> str:
    return str(get_settings().fmp_api_key or "").strip()


def _cache_get(key: str) -> str | None:
    r = get_sync_redis()
    if r is None:
        return None
    try:
        val = r.get(key)
        return str(val) if val else None
    except Exception:
        return None


def _cache_set(key: str, value: str) -> None:
    r = get_sync_redis()
    if r is None:
        return
    try:
        r.setex(key, _CACHE_TTL_SEC, value)
    except Exception:
        pass


async def get_revenue_trend(symbol: str) -> TrendDirection:
    """
    YoY revenue trend from the last four quarterly income statements.

    >10% YoY: growing, -5%..10%: flat, <-5%: declining. Never raises.
    """
    sym = symbol.strip().upper()
    if not sym:
        return "unknown"
    key = _api_key()
    if not key:
        return "unknown"

    cache_key = f"stocvest:fmp:revenue_trend:v1:{sym}"
    cached = _cache_get(cache_key)
    if cached in ("growing", "flat", "declining", "unknown"):
        return cached  # type: ignore[return-value]

    trend: TrendDirection = "unknown"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
            resp = await client.get(
                f"{FMP_STABLE_BASE}/income-statement",
                params={"symbol": sym, "period": "quarter", "limit": "8", "apikey": key},
            )
            resp.raise_for_status()
            rows = resp.json()
        if not isinstance(rows, list) or len(rows) < 2:
            _cache_set(cache_key, trend)
            return trend

        def _rev(row: dict) -> tuple[date, float] | None:
            if not isinstance(row, dict):
                return None
            rev = row.get("revenue")
            if rev is None:
                return None
            try:
                r = float(rev)
            except (TypeError, ValueError):
                return None
            if r <= 0:
                return None
            raw_d = row.get("date") or row.get("fillingDate")
            if not raw_d:
                return None
            try:
                d = date.fromisoformat(str(raw_d)[:10])
            except ValueError:
                return None
            return d, r

        parsed = [p for p in (_rev(r) for r in rows) if p is not None]
        parsed.sort(key=lambda x: x[0], reverse=True)
        if len(parsed) < 2:
            _cache_set(cache_key, trend)
            return trend

        latest_d, latest_rev = parsed[0]
        target = latest_d - timedelta(days=365)
        prior: tuple[date, float] | None = None
        for d, r in parsed[1:]:
            if d <= target:
                prior = (d, r)
                break
        if prior is None and len(parsed) >= 5:
            prior = parsed[4]
        if prior is None:
            _cache_set(cache_key, trend)
            return trend

        yoy = (latest_rev - prior[1]) / prior[1] * 100.0
        if yoy > 10.0:
            trend = "growing"
        elif yoy < -5.0:
            trend = "declining"
        else:
            trend = "flat"
    except Exception as exc:
        _LOG.warning("fmp_revenue_trend_failed symbol=%s err=%s", sym, type(exc).__name__)

    _cache_set(cache_key, trend)
    return trend


async def get_upcoming_earnings_date(symbol: str, *, window_days: int = 30) -> date | None:
    """Next earnings date within ``window_days``, if FMP is configured."""
    sym = symbol.strip().upper()
    if not sym:
        return None
    key = _api_key()
    if not key:
        return None

    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=max(1, int(window_days)))
    cache_key = f"stocvest:fmp:earnings_date:v1:{sym}:{today.isoformat()}:{end.isoformat()}"
    cached = _cache_get(cache_key)
    if cached:
        try:
            return date.fromisoformat(cached)
        except ValueError:
            pass

    best: date | None = None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
            resp = await client.get(
                f"{FMP_STABLE_BASE}/earnings-calendar",
                params={
                    "symbol": sym,
                    "from": today.isoformat(),
                    "to": end.isoformat(),
                    "apikey": key,
                },
            )
            resp.raise_for_status()
            rows = resp.json()
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw = row.get("date") or row.get("earningsDate")
                if raw is None:
                    continue
                try:
                    d = date.fromisoformat(str(raw)[:10])
                except ValueError:
                    continue
                if today <= d <= end and (best is None or d < best):
                    best = d
    except Exception as exc:
        _LOG.warning("fmp_earnings_calendar_failed symbol=%s err=%s", sym, type(exc).__name__)

    if best is not None:
        _cache_set(cache_key, best.isoformat())
    return best
