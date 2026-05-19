"""
Scheduled price cache warm for laggard intelligence (Chunk 9).

EventBridge action: ``warm_price_cache`` → ``laggard_jobs`` Lambda module.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.workers.market_open_setup import warm_price_cache_job
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def handler(event: Any, context: Any) -> dict[str, Any]:
    """Never raises — returns 200 with job stats."""
    _ = (event, context)
    try:
        body = asyncio.run(warm_price_cache_job())
        return {"statusCode": 200, **body}
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("price_cache_warmer_failed err=%s", type(exc).__name__)
        return {
            "statusCode": 200,
            "job": "warm_price_cache",
            "cached": 0,
            "errors": 0,
            "error": type(exc).__name__,
        }
