"""Scheduled job: resolve 1h / 1d signal outcomes via Polygon snapshots."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from stocvest.api.response import ok
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def signal_resolution_scheduled_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """EventBridge-scheduled entrypoint (no HTTP route). Always returns HTTP 200 to avoid EventBridge retry storms."""
    _ = context
    if isinstance(event, dict):
        src = event.get("source")
        _LOG.info("Signal resolution triggered by EventBridge: %s", src or "(unknown)")

    async def _run() -> dict[str, int]:
        settings = get_settings()
        rec = get_signal_recorder()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            resolved_1h = await rec.resolve_signals(60, client, horizon="1h")
            resolved_24h = await rec.resolve_signals(1440, client, horizon="1d")
        return {"resolved_1h": resolved_1h, "resolved_24h": resolved_24h}

    try:
        result = asyncio.run(_run())
        n1h = int(result["resolved_1h"])
        n24h = int(result["resolved_24h"])
        _LOG.info("Resolved: %s (1h), %s (24h)", n1h, n24h)
        # Keep legacy keys for callers that expect updated_1h / updated_1d
        payload = {
            "resolved_1h": n1h,
            "resolved_24h": n24h,
            "updated_1h": n1h,
            "updated_1d": n24h,
        }
        return ok(payload)
    except Exception as exc:
        _LOG.exception("Signal resolution error: %s", exc)
        body = {"error": str(exc), "resolved_1h": 0, "resolved_24h": 0}
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, separators=(",", ":")),
        }
