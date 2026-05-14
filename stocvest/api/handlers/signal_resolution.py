"""Scheduled job: resolve 1h / 1d signal outcomes for SignalHistory (D1 pipeline)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from stocvest.api.response import ok
from stocvest.api.services.ledger_position_monitor import run_ledger_position_monitor
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
        if str(event.get("stocvest_job") or "") == "geo_themes_update":
            try:
                from stocvest.workers.geo_themes_updater import update_geo_themes_sync

                return ok({"job": "geo_themes_update", **update_geo_themes_sync()})
            except Exception as exc:
                _LOG.exception("Geo themes update job error: %s", exc)
                return ok({"job": "geo_themes_update", "error": str(exc), "themes_count": 0})

    async def _run() -> dict[str, int]:
        settings = get_settings()
        rec = get_signal_recorder()
        raw_items = rec.list_raw_signal_items()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            ledger_counts = await run_ledger_position_monitor(client, rec)
            resolved_1h = await rec.resolve_signals(60, client, horizon="1h", items=raw_items)
            resolved_24h = await rec.resolve_signals(1440, client, horizon="1d", items=raw_items)
        out = {"resolved_1h": resolved_1h, "resolved_24h": resolved_24h, **ledger_counts}
        return out

    try:
        result = asyncio.run(_run())
        n1h = int(result["resolved_1h"])
        n24h = int(result["resolved_24h"])
        _LOG.info(
            "Ledger monitor: swing=%s day=%s skipped=%s errors=%s; Resolved: %s (1h), %s (24h)",
            result.get("swing_closed", 0),
            result.get("day_closed", 0),
            result.get("skipped", 0),
            result.get("errors", 0),
            n1h,
            n24h,
        )
        payload = {
            "resolved_1h": n1h,
            "resolved_24h": n24h,
            "updated_1h": n1h,
            "updated_1d": n24h,
            "ledger_swing_closed": int(result.get("swing_closed", 0)),
            "ledger_day_closed": int(result.get("day_closed", 0)),
            "ledger_monitor_skipped": int(result.get("skipped", 0)),
            "ledger_monitor_errors": int(result.get("errors", 0)),
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
