"""
AI-generated signal explanations for paid users (Haiku / AI_MODEL_FAST).

Free users receive deterministic copy only; Claude is never called without
has_ai_explanations on the user profile. Redis-backed cache with in-process fallback.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, replace
from datetime import datetime, time as dt_time, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx

from stocvest.data.models import NewsArticle, Newssentiment, UserProfile
from stocvest.signals.geopolitical_scanner import ANTHROPIC_API_URL, ANTHROPIC_VERSION
from stocvest.utils.api_rate_limits import await_claude_api_slot
from stocvest.utils.config import AI_MODEL_FAST, get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

ExplanationSource = Literal["ai", "deterministic"]

_memory_cache: dict[str, tuple[float, "ExplanationResult"]] = {}
_memory_lock = asyncio.Lock()


def reset_ai_explanation_caches_for_tests() -> None:
    """Clear in-process cache between tests."""
    _memory_cache.clear()


def _ny_calendar_date() -> str:
    et = ZoneInfo("America/New_York")
    return datetime.now(et).date().isoformat()


def _cache_ttl_seconds() -> int:
    """TTL until ~end of regular NY session (16:05 ET) on weekdays; else 1 hour."""
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    close = datetime.combine(now.date(), dt_time(16, 5), tzinfo=et)
    if now.weekday() < 5 and now < close:
        return max(120, int((close - now).total_seconds()))
    return 3600


def _capture_cache_key(*, symbol: str, score: int, verdict: str, ny_date: str) -> str:
    return f"stocvest:ai_explain:capture:{symbol.upper()}:{score}:{verdict.lower()}:{ny_date}"


def _news_cache_key(*, symbol: str, verdict: str, ny_date: str, fingerprint: str) -> str:
    return f"stocvest:ai_explain:news:{symbol.upper()}:{verdict.lower()}:{ny_date}:{fingerprint}"


def _article_fingerprint(articles: list[NewsArticle]) -> str:
    parts = [a.article_id for a in articles[:5]]
    joined = "|".join(parts) if parts else "none"
    return str(hash(joined) % (10**12))


@dataclass(frozen=True)
class ExplanationResult:
    text: str
    source: ExplanationSource
    upgrade_available: bool
    cached: bool = False


class AIExplanationService:
    """Paid-only Claude explanations with deterministic fallback and caching."""

    async def explain_signal_capture(
        self,
        *,
        symbol: str,
        score: int,
        verdict: str,
        top_layers: list[dict[str, Any]],
        risk_reward: float,
        user_profile: UserProfile,
    ) -> ExplanationResult:
        sym = symbol.strip().upper()
        v = verdict.strip().lower() or "neutral"
        rr = float(risk_reward) if risk_reward is not None else 0.0
        sc = int(score)
        ny_date = _ny_calendar_date()
        key = _capture_cache_key(symbol=sym, score=sc, verdict=v, ny_date=ny_date)

        if not user_profile.has_ai_explanations:
            return ExplanationResult(
                text=self._deterministic_capture_copy(sc, v, rr),
                source="deterministic",
                upgrade_available=True,
                cached=False,
            )

        hit = await self._cache_read(key)
        if hit is not None:
            return hit

        det = self._deterministic_capture_copy(sc, v, rr)
        text_ai = await self._claude_text_or_none(
            system=(
                "You are a signal analysis assistant. Output exactly 2 sentences explaining "
                "why this trading setup qualifies from the data given. Be specific. "
                "Never give investment advice. End with: Signal data only."
            ),
            user_prompt=self._build_capture_prompt(sym, sc, v, top_layers, rr),
            max_tokens=120,
        )
        if text_ai:
            result = ExplanationResult(text=text_ai.strip(), source="ai", upgrade_available=False, cached=False)
        else:
            result = ExplanationResult(text=det, source="deterministic", upgrade_available=False, cached=False)
        await self._cache_write(key, result)
        return result

    async def explain_news_synthesis(
        self,
        *,
        symbol: str,
        articles: list[NewsArticle],
        verdict: str,
        user_profile: UserProfile,
    ) -> ExplanationResult:
        sym = symbol.strip().upper()
        v = verdict.strip().lower() or "neutral"
        ny_date = _ny_calendar_date()
        top = articles[:5]
        fp = _article_fingerprint(top)
        key = _news_cache_key(symbol=sym, verdict=v, ny_date=ny_date, fingerprint=fp)

        if not user_profile.has_ai_explanations:
            return ExplanationResult(
                text=self._deterministic_news_copy(len(articles), v),
                source="deterministic",
                upgrade_available=True,
                cached=False,
            )

        hit = await self._cache_read(key)
        if hit is not None:
            return hit

        det = self._deterministic_news_copy(len(articles), v)
        if not top:
            return ExplanationResult(text=det, source="deterministic", upgrade_available=False, cached=False)

        text_ai = await self._claude_text_or_none(
            system=(
                "You are a signal analysis assistant. Summarize what recent news means for this "
                "trading setup in 2-3 sentences. Be specific to the headlines provided. "
                "Never give investment advice. Signal data only."
            ),
            user_prompt=self._build_news_prompt(sym, top, v),
            max_tokens=150,
        )
        if text_ai:
            result = ExplanationResult(text=text_ai.strip(), source="ai", upgrade_available=False, cached=False)
        else:
            result = ExplanationResult(text=det, source="deterministic", upgrade_available=False, cached=False)
        await self._cache_write(key, result)
        return result

    def _deterministic_capture_copy(self, score: int, verdict: str, rr: float) -> str:
        rr_text = "acceptable" if rr >= 2.0 else "tight"
        return (
            f"This {verdict} setup scored {score}/100 based on layer agreement and signal strength. "
            f"R/R is {rr:.1f}:1 ({rr_text}). Open Evidence for full layer detail."
        )

    def _deterministic_news_copy(self, article_count: int, verdict: str) -> str:
        if article_count == 0:
            return "No qualifying news in the lookback window."
        return (
            f"{article_count} news articles scored for this ticker. Sentiment aligns with {verdict} composite. "
            "Open Evidence for full news detail."
        )

    def _build_capture_prompt(
        self,
        symbol: str,
        score: int,
        verdict: str,
        top_layers: list[dict[str, Any]],
        risk_reward: float,
    ) -> str:
        layers_compact = [
            {
                "layer": str(x.get("layer") or ""),
                "status": str(x.get("status") or ""),
                "score": x.get("score"),
            }
            for x in (top_layers or [])[:6]
        ]
        return (
            f"symbol={symbol}\n"
            f"composite_score_0_100={score}\n"
            f"verdict={verdict}\n"
            f"risk_reward={risk_reward}\n"
            f"top_layers={json.dumps(layers_compact)}\n"
        )

    def _build_news_prompt(self, symbol: str, articles: list[NewsArticle], verdict: str) -> str:
        lines: list[str] = [f"symbol={symbol}", f"composite_verdict={verdict}", "headlines="]
        for a in articles:
            sent = a.sentiment.value if a.sentiment else "unknown"
            lines.append(f"- {a.title[:200]} | sentiment={sent} | score={a.sentiment_score}")
        return "\n".join(lines)

    async def _cache_read(self, key: str) -> ExplanationResult | None:
        now = time.time()
        async with _memory_lock:
            mem = _memory_cache.get(key)
            if mem and mem[0] > now:
                return replace(mem[1], cached=True)
            if mem:
                del _memory_cache[key]

        r = get_sync_redis()
        if not r:
            return None
        try:
            raw = r.get(key)
            if not raw:
                return None
            payload = json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else raw)
            return ExplanationResult(
                text=str(payload.get("text") or ""),
                source="ai" if payload.get("source") == "ai" else "deterministic",
                upgrade_available=bool(payload.get("upgrade_available")),
                cached=True,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            _LOG.debug("ai_explanations cache read skip: %s", type(exc).__name__)
            return None

    async def _cache_write(self, key: str, result: ExplanationResult) -> None:
        ttl = _cache_ttl_seconds()
        exp = time.time() + ttl
        async with _memory_lock:
            _memory_cache[key] = (exp, replace(result, cached=False))
        r = get_sync_redis()
        if not r:
            return
        try:
            payload = json.dumps(
                {
                    "text": result.text,
                    "source": result.source,
                    "upgrade_available": result.upgrade_available,
                }
            )
            r.setex(key, ttl, payload)
        except Exception as exc:
            _LOG.debug("ai_explanations cache write skip: %s", type(exc).__name__)

    async def _claude_text_or_none(self, *, system: str, user_prompt: str, max_tokens: int) -> str | None:
        settings = get_settings()
        # Tests may monkeypatch env vars after settings cache is primed.
        api_key = (settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            return None
        payload = {
            "model": AI_MODEL_FAST,
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [{"role": "user", "content": f"{system}\n\n{user_prompt}"}],
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
                return None
            body = res.json()
            blocks = body.get("content")
            if not isinstance(blocks, list) or not blocks:
                return None
            text = str(blocks[0].get("text") or "").strip()
            return text or None
        except (httpx.HTTPError, TypeError, KeyError, json.JSONDecodeError, asyncio.TimeoutError) as exc:
            _LOG.debug("ai_explanations claude skip: %s", type(exc).__name__)
            return None


def news_articles_from_payload(raw: list[object]) -> list[NewsArticle]:
    """Build minimal NewsArticle rows from client JSON (titles + optional sentiment)."""
    out: list[NewsArticle] = []
    for i, item in enumerate(raw[:20]):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        aid = str(item.get("article_id") or item.get("id") or f"synth-{i}")
        pub_raw = item.get("published_at") or item.get("published_utc")
        try:
            pub = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            pub = datetime.now(tz=timezone.utc)
        sent_raw = str(item.get("sentiment") or "").strip().lower()
        sent: Newssentiment | None = None
        if sent_raw in ("bullish", "bearish", "neutral"):
            sent = Newssentiment(sent_raw)
        score_raw = item.get("sentiment_score")
        score_f: float | None
        try:
            score_f = float(score_raw) if score_raw is not None else None
        except (TypeError, ValueError):
            score_f = None
        url = str(item.get("url") or "https://example.invalid")
        out.append(
            NewsArticle(
                article_id=aid,
                published_at=pub,
                title=title[:500],
                url=url,
                sentiment=sent,
                sentiment_score=score_f,
            )
        )
    return out
