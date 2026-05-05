"""Scheduled job: resolve 1h / 1d signal outcomes; model-portfolio stop/target checks; daily reversal scan."""

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


async def _check_model_portfolio_exits(client: PolygonClient) -> None:
    """Every scheduled tick: evaluate open tracked positions vs last trade (stop / target / time exit)."""
    from stocvest.api.services.portfolio_recorder import get_portfolio_recorder

    rec = get_portfolio_recorder()
    opens = rec.get_open_positions()
    if not opens:
        return
    symbols = sorted({str(p.get("symbol") or "").upper() for p in opens if p.get("symbol")})
    if not symbols:
        return
    snaps = await client.get_snapshots(symbols)
    for pos in opens:
        sym = str(pos.get("symbol") or "").upper()
        sp = snaps.get(sym) or snaps.get(sym.upper()) or next((v for k, v in snaps.items() if str(k).upper() == sym), None)
        if not sp or sp.last_trade_price is None:
            continue
        last = float(sp.last_trade_price)
        if last <= 0:
            continue
        rec.check_stop_and_target(symbol=sym, current_price=last)


async def _portfolio_reversal_async() -> dict[str, Any]:
    """Weekday job: if a fresh composite flips bearish or weak, close the tracked position (signal reversed)."""
    from stocvest.api.services.portfolio_recorder import ExitReason, get_portfolio_recorder
    from stocvest.api.services.portfolio_reversal import get_composite_verdict_only
    from stocvest.config.parameter_store import ParameterStore

    settings = get_settings()
    params = ParameterStore.get_parameters_sync()
    rec = get_portfolio_recorder()
    opens = rec.get_open_positions()
    if not opens:
        return {"job": "portfolio_reversal", "checked": 0, "closed": 0}
    closed_n = 0
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        for pos in opens:
            sym = str(pos.get("symbol") or "").upper()
            pid = str(pos.get("position_id") or "")
            if not sym or not pid:
                continue
            v = await get_composite_verdict_only(symbol=sym, params=params)
            if v.status == "insufficient_data":
                continue
            verdict = v.signal_summary.strip().lower()
            score_0_100 = v.score_0_100
            snap = await client.get_snapshot(sym)
            last = float(snap.last_trade_price or 0.0)
            if last <= 0:
                continue
            if verdict == "bearish" or score_0_100 <= 35:
                if rec.close_position(pid, last, ExitReason.SIGNAL_REVERSED):
                    closed_n += 1
    return {"job": "portfolio_reversal", "checked": len(opens), "closed": closed_n}


def signal_resolution_scheduled_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """EventBridge-scheduled entrypoint (no HTTP route). Always returns HTTP 200 to avoid EventBridge retry storms."""
    _ = context
    if isinstance(event, dict):
        src = event.get("source")
        _LOG.info("Signal resolution triggered by EventBridge: %s", src or "(unknown)")
        if str(event.get("stocvest_job") or "") == "portfolio_reversal":
            try:
                result = asyncio.run(_portfolio_reversal_async())
                return ok(result)
            except Exception as exc:
                _LOG.exception("Portfolio reversal job error: %s", exc)
                return ok({"job": "portfolio_reversal", "error": str(exc), "closed": 0})

    async def _run() -> dict[str, int]:
        settings = get_settings()
        rec = get_signal_recorder()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            resolved_1h = await rec.resolve_signals(60, client, horizon="1h")
            resolved_24h = await rec.resolve_signals(1440, client, horizon="1d")
            await _check_model_portfolio_exits(client)
        return {"resolved_1h": resolved_1h, "resolved_24h": resolved_24h}

    try:
        result = asyncio.run(_run())
        n1h = int(result["resolved_1h"])
        n24h = int(result["resolved_24h"])
        _LOG.info("Resolved: %s (1h), %s (24h)", n1h, n24h)
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
