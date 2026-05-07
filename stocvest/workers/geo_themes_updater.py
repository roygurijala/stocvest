"""
Daily EventBridge job (scheduled in Terraform).
Fetches active geopolitical themes from Perplexity Sonar.
Stores JSON in Redis for GeoAnalyzer baseline (24h TTL).
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from stocvest.utils.config import PERPLEXITY_API_KEY
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"
GEO_THEMES_KEY = "stocvest:geo_themes:today"
GEO_THEMES_TTL = 86400

GEO_PROMPT = """You are a financial markets analyst.
What geopolitical situations are currently ACTIVE
and directly affecting US equity market sectors TODAY?

Include only: active military conflicts, trade wars
or tariffs in effect, active sanctions, central bank
policy divergence with market impact, commodity
supply disruptions.

Exclude: resolved situations, historical events,
political news without clear market impact.

Return ONLY valid JSON — no markdown, no other text:
{
  "active_themes": [
    {
      "key": "snake_case_key",
      "display_name": "Human Readable Name",
      "description": "One sentence: what + market impact",
      "primary_sectors": ["sector1", "sector2"],
      "risk_level": "high|medium|low",
      "started_approx": "YYYY-MM"
    }
  ],
  "as_of": "ISO_TIMESTAMP",
  "source": "perplexity_sonar"
}

Valid sector values only:
energy, semiconductors, technology, software,
airlines, shipping, financials, real_estate,
consumer_discretionary, communication_services,
healthcare, materials, industrials, utilities, defense

Return 1-5 themes maximum.
If no active themes: return active_themes as [].
"""

FALLBACK_THEMES: dict[str, Any] = {
    "active_themes": [
        {
            "key": "us_china_trade_tension",
            "display_name": "US-China Trade Tension",
            "description": (
                "Semiconductor and tech export restrictions between US and China affecting chip supply chains."
            ),
            "primary_sectors": ["semiconductors", "technology"],
            "risk_level": "high",
            "started_approx": "2026-01",
        },
        {
            "key": "middle_east_conflict",
            "display_name": "Middle East Conflict",
            "description": ("Regional conflict affecting oil supply and energy sector risk."),
            "primary_sectors": ["energy", "airlines", "shipping"],
            "risk_level": "medium",
            "started_approx": "2026-02",
        },
    ],
    "as_of": "fallback",
    "source": "fallback_static",
}


async def fetch_from_perplexity() -> dict[str, Any]:
    """Call Perplexity Sonar. Returns parsed JSON dict. Raises on failure."""
    key = PERPLEXITY_API_KEY.strip()
    if not key:
        raise ValueError("perplexity key missing")

    async with httpx.AsyncClient(timeout=30.0) as c:
        resp = await c.post(
            PERPLEXITY_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "sonar",
                "messages": [{"role": "user", "content": GEO_PROMPT}],
                "search_recency_filter": "day",
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()

    content = str(resp.json()["choices"][0]["message"]["content"] or "").strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        content = "\n".join(lines).strip()

    return json.loads(content)


def get_cached_themes() -> dict[str, Any]:
    """
    Read today's themes from Redis.
    Supports legacy payloads with key ``themes`` (list[str]).
    """
    try:
        import redis

        from stocvest.utils.config import REDIS_URL

        r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        cached = r.get(GEO_THEMES_KEY)
        if not cached:
            return FALLBACK_THEMES
        data = json.loads(cached)
        if not isinstance(data, dict):
            return FALLBACK_THEMES
        if "active_themes" in data and isinstance(data["active_themes"], list):
            return data
        raw_themes = data.get("themes")
        if isinstance(raw_themes, list) and raw_themes:
            active = []
            for t in raw_themes[:7]:
                s = str(t).strip()
                if not s:
                    continue
                slug = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in s.lower()).strip("_")[:48]
                active.append(
                    {
                        "key": slug or "theme",
                        "display_name": s,
                        "description": s,
                        "primary_sectors": [],
                        "risk_level": "medium",
                        "started_approx": "",
                    }
                )
            return {"active_themes": active, "as_of": "legacy", "source": "redis_legacy"}
        return FALLBACK_THEMES
    except Exception as exc:
        _LOG.warning("geo_themes_redis_read_failed error=%s", str(exc))
    return FALLBACK_THEMES


async def update_geo_themes() -> dict[str, Any]:
    try:
        themes = await fetch_from_perplexity()
        themes.setdefault("active_themes", [])
        if not isinstance(themes.get("active_themes"), list):
            themes["active_themes"] = []
        if "source" not in themes:
            themes["source"] = "perplexity"
        src = "perplexity"
        _LOG.info("geo_themes_fetched count=%d source=perplexity key_loaded=true", len(themes["active_themes"]))
    except Exception as exc:
        _LOG.warning(
            "geo_themes_perplexity_failed error=%s using_fallback=true key_loaded=true",
            str(exc),
        )
        themes = dict(FALLBACK_THEMES)

    try:
        import redis

        from stocvest.utils.config import REDIS_URL

        r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        r.setex(GEO_THEMES_KEY, GEO_THEMES_TTL, json.dumps(themes))
        _LOG.info("geo_themes_cached source=%s", themes.get("source"))
    except Exception as exc:
        _LOG.error("geo_themes_redis_write_failed error=%s", str(exc))

    return themes


def handler(event: Any, context: Any) -> dict[str, Any]:
    """AWS Lambda handler for EventBridge (module ``geo_themes`` in lambda_dispatch)."""
    _ = (event, context)
    result = asyncio.run(update_geo_themes())
    n = len(result.get("active_themes") or []) if isinstance(result, dict) else 0
    return {"statusCode": 200, "themes_count": n}
