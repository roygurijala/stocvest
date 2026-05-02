"""Scheduled job: resolve 1h / 1d signal outcomes via Polygon snapshots."""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.response import internal_error, ok
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def signal_resolution_scheduled_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """EventBridge-scheduled entrypoint (no HTTP route)."""
    _ = context
    if isinstance(event, dict) and event.get("source") == "aws.events":
        _LOG.info("signal resolution tick: %s", event.get("id", ""))

    async def _run() -> dict[str, int]:
        settings = get_settings()
        rec = get_signal_recorder()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            n1h = await rec.resolve_signals(60, client, horizon="1h")
            n1d = await rec.resolve_signals(1440, client, horizon="1d")
        return {"updated_1h": n1h, "updated_1d": n1d}

    try:
        result = asyncio.run(_run())
        return ok(result)
    except Exception as exc:
        return internal_error(str(exc))
