"""
Pre-IPO context monitor — Perplexity → Redis activations (Chunk 9).

Stores trigger entity names at ``stocvest:pre_ipo_active:{date}`` (24h TTL)
for the laggard assembler.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from stocvest.data.sector_peer_registry import get_group_by_trigger_entity, get_pre_ipo_proxy_groups
from stocvest.utils.config import PERPLEXITY_API_KEY
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"
_PRE_IPO_TTL_SEC = 86400
_ET = ZoneInfo("America/New_York")

PRE_IPO_PROMPT = """What news about major pre-IPO technology companies
(OpenAI, Anthropic, SpaceX, Stripe, Databricks, Waymo, xAI, Anduril)
is affecting or likely to affect US public markets today?

For each item:
  - Company name
  - Nature of news
  - Which public stocks are most exposed
  - Direction of expected effect

If no significant news: respond with exactly:
{"activated_entities": [], "summary": "No pre-IPO news today."}

Otherwise return ONLY valid JSON — no markdown:
{
  "activated_entities": ["OpenAI", "SpaceX"],
  "summary": "One sentence overview"
}

Signal data context only. No investment advice."""


def _session_date_et() -> str:
    return datetime.now(_ET).date().isoformat()


def pre_ipo_active_key(session_date: str | None = None) -> str:
    day = session_date or _session_date_et()
    return f"stocvest:pre_ipo_active:{day}"


def _strip_markdown_fences(content: str) -> str:
    text = (content or "").strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return text


def _known_entities() -> list[str]:
    return [g.trigger_entity for g in get_pre_ipo_proxy_groups() if g.trigger_entity]


def _entities_from_text(content: str) -> list[str]:
    known = _known_entities()
    found: list[str] = []
    for entity in known:
        if entity and re.search(rf"\b{re.escape(entity)}\b", content, flags=re.IGNORECASE):
            found.append(entity)
    return list(dict.fromkeys(found))


def _parse_entities(content: str) -> list[str]:
    text = _strip_markdown_fences(content)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            raw = parsed.get("activated_entities")
            if isinstance(raw, list):
                out: list[str] = []
                for item in raw:
                    name = str(item).strip()
                    group = get_group_by_trigger_entity(name)
                    if group and group.trigger_entity:
                        out.append(group.trigger_entity)
                return list(dict.fromkeys(out))
    except json.JSONDecodeError:
        pass
    return _entities_from_text(text)


async def fetch_pre_ipo_from_perplexity() -> tuple[list[str], str]:
    key = PERPLEXITY_API_KEY.strip()
    if not key:
        raise ValueError("perplexity key missing")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            PERPLEXITY_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "sonar",
                "messages": [{"role": "user", "content": PRE_IPO_PROMPT}],
                "search_recency_filter": "day",
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()

    content = str(resp.json()["choices"][0]["message"]["content"] or "")
    entities = _parse_entities(content)
    summary = "No pre-IPO news today."
    try:
        parsed = json.loads(_strip_markdown_fences(content))
        if isinstance(parsed, dict) and parsed.get("summary"):
            summary = str(parsed["summary"])
    except json.JSONDecodeError:
        summary = content[:240] if content else summary
    return entities, summary


def store_activated_entities(entities: list[str], *, session_date: str | None = None) -> bool:
    r = get_sync_redis()
    if r is None:
        return False
    try:
        r.setex(pre_ipo_active_key(session_date), _PRE_IPO_TTL_SEC, json.dumps(entities))
        return True
    except Exception as exc:
        _LOG.warning("pre_ipo_redis_write_failed err=%s", type(exc).__name__)
        return False


async def run_pre_ipo_monitor() -> dict[str, Any]:
    day = _session_date_et()
    try:
        entities, summary = await fetch_pre_ipo_from_perplexity()
        source = "perplexity"
    except Exception as exc:
        _LOG.warning("pre_ipo_perplexity_failed err=%s", type(exc).__name__)
        entities = []
        summary = "Monitor unavailable — no activations stored."
        source = "error"

    stored = store_activated_entities(entities, session_date=day)
    return {
        "job": "pre_ipo_monitor",
        "session_date": day,
        "activated_entities": entities,
        "activated_count": len(entities),
        "summary": summary,
        "source": source,
        "redis_stored": stored,
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    """EventBridge entry — never raises."""
    _ = (event, context)
    try:
        body = asyncio.run(run_pre_ipo_monitor())
        return {"statusCode": 200, **body}
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("pre_ipo_monitor_handler_failed err=%s", type(exc).__name__)
        day = _session_date_et()
        store_activated_entities([], session_date=day)
        return {
            "statusCode": 200,
            "job": "pre_ipo_monitor",
            "session_date": day,
            "activated_entities": [],
            "activated_count": 0,
            "error": type(exc).__name__,
        }
