"""Shared Perplexity Sonar client with JSON parsing and optional Upstash cache."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from stocvest.data.dashboard_cache import read_dashboard_cache, upstash_configured, write_dashboard_cache
from stocvest.utils.config import PERPLEXITY_API_KEY
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"


def _strip_markdown_json(content: str) -> str:
    text = (content or "").strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return text


def _parse_json_content(content: str) -> dict[str, Any]:
    text = _strip_markdown_json(content)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                pass
    return {}


def perplexity_cache_key(kind: str, symbol: str) -> str:
    sym = str(symbol or "").strip().upper()
    k = str(kind or "generic").strip().lower()
    return f"stocvest:perplexity:{k}:{sym}:v1"


async def perplexity_sonar_json(
    *,
    prompt: str,
    search_recency_filter: str = "month",
    cache_key: str | None = None,
) -> dict[str, Any] | None:
    """
    Call Perplexity Sonar and return parsed JSON dict.
    Returns None when the API key is missing or the request fails.
    """
    if cache_key and upstash_configured():
        cached = read_dashboard_cache(cache_key)
        if cached and isinstance(cached.get("data"), dict):
            return dict(cached["data"])

    key = (PERPLEXITY_API_KEY or "").strip()
    if not key:
        _LOG.debug("perplexity_skip reason=no_api_key")
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                PERPLEXITY_URL,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "sonar",
                    "messages": [{"role": "user", "content": prompt}],
                    "search_recency_filter": search_recency_filter,
                    "temperature": 0.1,
                },
            )
            resp.raise_for_status()
        content = str(resp.json()["choices"][0]["message"]["content"] or "")
        data = _parse_json_content(content)
        if not data:
            return None
        if cache_key and upstash_configured():
            write_dashboard_cache(cache_key, data, "perplexity", "swing")
        return data
    except Exception as exc:
        _LOG.warning("perplexity_sonar_failed err=%s", type(exc).__name__)
        return None
