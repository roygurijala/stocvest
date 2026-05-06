"""Optional Claude one-liner for per-stock geo exposure (Layer 4 LLM path)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from stocvest.signals.geopolitical_scanner import ANTHROPIC_API_URL, ANTHROPIC_VERSION, DEFAULT_MODEL
from stocvest.utils.api_rate_limits import await_claude_api_slot
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def try_claude_geo_exposure_line(
    *,
    events: list[dict[str, Any]],
    impact_sector_key: str,
    weighted_score: float,
    template_fallback: str,
    timeout_seconds: float = 8.0,
) -> str | None:
    """
    Returns a single concise exposure phrase, or None to keep the template summary.
    """
    settings = get_settings()
    if not settings.anthropic_api_key or not events or not impact_sector_key or impact_sector_key == "default":
        return None

    payload = {
        "model": DEFAULT_MODEL,
        "max_tokens": 120,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": (
                    "You summarize stock-specific geopolitical exposure for traders.\n"
                    "Given structured active geo themes (event_type + severity score), the stock's "
                    "mapped sector bucket, and a weighted exposure score (higher = more headline "
                    "sensitivity for that sector), output ONE short sentence (max 140 chars), no quotes.\n"
                    "Use plain English like 'Limited direct exposure' or 'Significant supply-chain/policy risk' "
                    "when warranted.\n\n"
                    f"events_json={json.dumps(events[:6])}\n"
                    f"sector_bucket={impact_sector_key}\n"
                    f"weighted_score={weighted_score}\n"
                    f"template_hint={template_fallback[:200]}"
                ),
            }
        ],
    }
    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        await await_claude_api_slot()
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            res = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
        if res.status_code >= 400:
            _LOG.debug("geo_exposure_llm http %s", res.status_code)
            return None
        body = res.json()
        blocks = body.get("content")
        if not isinstance(blocks, list) or not blocks:
            return None
        text = str(blocks[0].get("text") or "").strip()
        if not text:
            return None
        return text[:240]
    except (httpx.HTTPError, TypeError, KeyError, json.JSONDecodeError, asyncio.TimeoutError) as exc:
        _LOG.debug("geo_exposure_llm skipped: %s", type(exc).__name__)
        return None
