"""
Plain-English daily market brief (Haiku / AI_MODEL_FAST), user-agnostic + Redis-cached.

Assembles deterministic market data already available server-side (index tape,
sector ETF moves, top headlines, market status) and makes a single Claude call to
write a concise "what's happening in the market" narrative for the dashboard brief.

The narrative is the same for every user, so it is cached once (short TTL during
regular hours, longer when the tape is shut) and shared — one Claude call per refresh
window keeps cost negligible. When no Anthropic key is configured or the upstream
call fails, returns ``None`` and the frontend falls back to its deterministic summary.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, time as dt_time, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from stocvest.api.services.dashboard_summary import build_dashboard_summary
from stocvest.data import PolygonClient
from stocvest.data.polygon_client import LIQUID_NEWS_TICKERS
from stocvest.signals.geopolitical_scanner import ANTHROPIC_API_URL, ANTHROPIC_VERSION
from stocvest.utils.api_rate_limits import await_claude_api_slot
from stocvest.utils.config import AI_MODEL_FAST, get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

# Warm-container fallback cache: this Lambda often runs with Redis disabled
# (STOCVEST_DISABLE_REDIS=1), so the shared cache no-ops. A module-level cache keyed by
# the 10-minute window keeps warm invocations instant and avoids a Claude call per request.
_INPROC_CACHE: dict[str, dict[str, Any]] = {}

_SECTOR_LABELS: dict[str, str] = {
    "XLK": "Tech",
    "XLC": "Comm",
    "XLE": "Energy",
    "XLF": "Financials",
    "XLY": "Cons. disc.",
}
_INDEX_LABELS: dict[str, str] = {"SPY": "S&P 500", "QQQ": "Nasdaq 100", "IWM": "Small caps"}


def _ny_now() -> datetime:
    return datetime.now(ZoneInfo("America/New_York"))


def _is_regular_hours(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    open_t = dt_time(9, 30)
    close_t = dt_time(16, 0)
    return open_t <= now.timetz().replace(tzinfo=None) <= close_t


def _cache_ttl_seconds(now: datetime) -> int:
    return 600 if _is_regular_hours(now) else 3600


def _cache_key(now: datetime) -> str:
    # Bucket by 10-minute window so all users in a window share one narrative.
    bucket = now.strftime("%Y%m%d%H") + f"{now.minute // 10}"
    return f"stocvest:market_brief:narrative:{bucket}"


def _is_vix_symbol(sym: str) -> bool:
    u = str(sym or "").strip().upper()
    return u in ("I:VIX", "^VIX", "VIX") or u.endswith(":VIX")


def _snapshot_pct(snap: dict[str, Any]) -> float | None:
    cp = snap.get("change_percent")
    if isinstance(cp, (int, float)) and cp == cp and cp > -99.5:
        return float(cp)
    last = snap.get("last_trade_price")
    prev = snap.get("prev_close")
    if (
        isinstance(last, (int, float))
        and isinstance(prev, (int, float))
        and prev not in (0, None)
        and prev == prev
        and last == last
    ):
        return ((float(last) - float(prev)) / float(prev)) * 100.0
    return None


def _pct1d_from_closes(closes: list[float]) -> float | None:
    if not isinstance(closes, list) or len(closes) < 2:
        return None
    start, end = closes[-2], closes[-1]
    if not (isinstance(start, (int, float)) and isinstance(end, (int, float)) and start > 0):
        return None
    return ((end - start) / start) * 100.0


async def _top_headlines(client: PolygonClient, *, limit: int = 8) -> list[dict[str, str]]:
    from datetime import timedelta

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    tickers = list(LIQUID_NEWS_TICKERS)[:15]
    try:
        raw = await client.get_market_news(tickers=tickers, limit=40, order="desc", published_utc_gte=since)
    except Exception as exc:  # noqa: BLE001 - news is optional context
        _LOG.debug("market_brief headlines skip: %s", type(exc).__name__)
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for article in raw or []:
        title = str(article.get("title") or "").strip()
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        publisher = str(((article.get("publisher") or {}).get("name") or "")).strip()
        out.append({"title": title, "publisher": publisher})
        if len(out) >= limit:
            break
    return out


def _assemble_market_data(summary: dict[str, Any], headlines: list[dict[str, str]]) -> dict[str, Any]:
    snapshots = summary.get("snapshots") or []
    by_symbol: dict[str, dict[str, Any]] = {}
    for snap in snapshots:
        sym = str(snap.get("symbol") or "").strip().upper()
        if sym:
            by_symbol[sym] = snap

    indices: list[dict[str, Any]] = []
    for sym, label in _INDEX_LABELS.items():
        snap = by_symbol.get(sym)
        pct = _snapshot_pct(snap) if snap else None
        if pct is not None:
            indices.append({"label": label, "symbol": sym, "pct": round(pct, 2)})

    vix_snap = by_symbol.get("I:VIX") or by_symbol.get("^VIX") or by_symbol.get("VIX")
    vix_level = None
    if vix_snap:
        lvl = vix_snap.get("last_trade_price")
        if isinstance(lvl, (int, float)) and lvl == lvl and lvl > 0:
            vix_level = round(float(lvl), 1)

    daily_closes = summary.get("daily_closes") or {}
    sectors: list[dict[str, Any]] = []
    for sym, label in _SECTOR_LABELS.items():
        pct = _pct1d_from_closes(daily_closes.get(sym) or [])
        if pct is not None:
            sectors.append({"label": label, "pct": round(pct, 2)})
    sectors.sort(key=lambda s: s["pct"], reverse=True)

    status = summary.get("status") or {}
    market_state = str(status.get("market") or "").strip().lower() or "unknown"

    return {
        "market_state": market_state,
        "indices": indices,
        "vix": vix_level,
        "sectors": sectors,
        "headlines": headlines,
    }


def _system_prompt() -> str:
    return (
        "You are a markets-desk analyst writing a concise, plain-English market brief for a retail "
        "trading app. Use ONLY the structured data provided — never invent numbers, tickers, or events. "
        "Write 3 to 5 short sentences. No bullet points, no headers, no emojis, no financial advice, no "
        "hype. If the market is open, describe how it is trading right now; if closed, describe how the "
        "session finished. Cover: overall index direction, sector leadership vs laggards, the volatility "
        "backdrop (VIX) if present, and the dominant news theme if the headlines point to one. Keep it "
        "factual and readable for a non-professional."
    )


def _has_enough_data(data: dict[str, Any]) -> bool:
    return bool(data.get("indices")) or bool(data.get("sectors"))


async def _claude_narrative_or_none(data: dict[str, Any]) -> str | None:
    settings = get_settings()
    api_key = (getattr(settings, "anthropic_api_key", None) or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        _LOG.warning("market_brief: ANTHROPIC_API_KEY not configured; skipping narrative.")
        return None
    user_prompt = "Market data (JSON):\n" + json.dumps(data, ensure_ascii=False)
    payload = {
        "model": AI_MODEL_FAST,
        "max_tokens": 360,
        "temperature": 0,
        "messages": [{"role": "user", "content": f"{_system_prompt()}\n\n{user_prompt}"}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        await await_claude_api_slot()
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
        if res.status_code >= 400:
            _LOG.warning("market_brief: Claude returned HTTP %s; skipping narrative.", res.status_code)
            return None
        body = res.json()
        blocks = body.get("content")
        if not isinstance(blocks, list) or not blocks:
            return None
        text = str(blocks[0].get("text") or "").strip()
        return text or None
    except (httpx.HTTPError, TypeError, KeyError, json.JSONDecodeError, asyncio.TimeoutError) as exc:
        _LOG.debug("market_brief claude skip: %s", type(exc).__name__)
        return None


async def _build_narrative_live() -> dict[str, Any] | None:
    settings = get_settings()
    try:
        summary = await build_dashboard_summary(earnings_symbols=[], settings=settings)
    except Exception as exc:  # noqa: BLE001 - never fail the dashboard over the optional brief
        _LOG.warning("market_brief summary fetch failed: %s", type(exc).__name__)
        return None

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        headlines = await _top_headlines(client)

    data = _assemble_market_data(summary, headlines)
    if not _has_enough_data(data):
        return None
    narrative = await _claude_narrative_or_none(data)
    if not narrative:
        return None
    return {
        "narrative": narrative,
        "model": AI_MODEL_FAST,
        "market_state": data["market_state"],
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def get_market_brief_narrative() -> dict[str, Any] | None:
    """Cached, user-agnostic AI market narrative. Returns ``None`` to signal frontend fallback."""
    now = _ny_now()
    key = _cache_key(now)

    # 1) Warm-container in-process cache (works even when Redis is disabled).
    inproc = _INPROC_CACHE.get(key)
    if isinstance(inproc, dict) and inproc.get("narrative"):
        return {**inproc, "cached": True}

    redis = None
    try:
        redis = get_sync_redis()
    except Exception:  # noqa: BLE001 - cache is best-effort
        redis = None

    # 2) Shared Redis cache (no-op when STOCVEST_DISABLE_REDIS=1).
    if redis is not None:
        try:
            cached = redis.get(key)
            if cached:
                parsed = json.loads(cached)
                if isinstance(parsed, dict) and parsed.get("narrative"):
                    _INPROC_CACHE[key] = parsed
                    parsed["cached"] = True
                    return parsed
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("market_brief cache read skip: %s", type(exc).__name__)

    # 3) Build live (≈5–6s: dashboard summary + headlines + one Claude call).
    result = asyncio.run(_build_narrative_live())
    if not result:
        return None

    # Cap the in-process cache so a long-lived warm container can't grow unbounded.
    if len(_INPROC_CACHE) > 8:
        _INPROC_CACHE.clear()
    _INPROC_CACHE[key] = result

    if redis is not None:
        try:
            redis.setex(key, _cache_ttl_seconds(now), json.dumps(result))
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("market_brief cache write skip: %s", type(exc).__name__)

    result["cached"] = False
    return result
