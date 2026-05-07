"""
Warms FRED-backed macro cache before RTH (EventBridge Scheduler).

Pre-fetches upcoming release dates and Treasury yield curve into Redis so the first
composite request of the day often hits cache.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.data.fred_client import FREDClient
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def warm_macro_cache() -> dict[str, Any]:
    client = FREDClient()
    events = await client.get_upcoming_events(7)
    yield_curve = await client.get_yield_curve()
    regime = yield_curve.get("regime") if isinstance(yield_curve, dict) else None
    _LOG.info("macro_cache_warmed events=%s yield_regime=%s", len(events), regime or "unavailable")
    return {
        "statusCode": 200,
        "events": len(events),
        "yield_curve": bool(yield_curve),
        "yield_regime": regime,
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    return asyncio.run(warm_macro_cache())
