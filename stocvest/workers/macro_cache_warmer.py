"""
Warms FRED-backed macro cache before RTH (EventBridge Scheduler).

Pre-fetches upcoming release dates and Treasury yield curve into Redis so the first
composite request of the day often hits cache.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache
from stocvest.data.fred_client import FREDClient
from stocvest.signals.macro_event import MacroEvent
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _macro_event_to_json(e: MacroEvent) -> dict[str, Any]:
    return {
        "event_id": e.event_id,
        "name": e.name,
        "category": e.category.value,
        "country": e.country,
        "scheduled_time": e.scheduled_time.isoformat(),
        "importance": e.importance,
        "source": e.source,
        "status": e.status.value,
        "actual": e.actual,
        "forecast": e.forecast,
        "previous": e.previous,
    }


async def warm_macro_cache() -> dict[str, Any]:
    client = FREDClient()
    events = await client.get_upcoming_events(7)
    yield_curve = await client.get_yield_curve()
    regime = yield_curve.get("regime") if isinstance(yield_curve, dict) else None
    _LOG.info("macro_cache_warmed events=%s yield_regime=%s", len(events), regime or "unavailable")
    try:
        write_dashboard_cache(
            DashboardKeys.UPCOMING_EVENTS,
            {"events": [_macro_event_to_json(e) for e in events], "event_count": len(events)},
            "upcoming_events",
            "swing",
        )
    except Exception as exc:
        _LOG.warning("macro_upstash_dashboard_write_failed err=%s", exc)
    return {
        "statusCode": 200,
        "events": len(events),
        "yield_curve": bool(yield_curve),
        "yield_regime": regime,
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    return asyncio.run(warm_macro_cache())
