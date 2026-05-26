"""Opportunity Desk HTTP handlers."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, ok, too_many_requests, unauthorized
from stocvest.api.services.opportunity_desk.batch import opportunity_desk_redis_key
from stocvest.api.services.opportunity_desk.desk_refresh import (
    DeskRefreshCooldownError,
    run_manual_desk_refresh,
)
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.dashboard_cache import read_dashboard_cache
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

DeskMode = Literal["swing", "day"]


def _parse_desk_mode(event: LambdaEvent) -> DeskMode | None:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        query = {}
    raw = str(query.get("mode") or "swing").strip().lower()
    if raw in ("day", "intraday", "real"):
        return "day"
    if raw in ("swing", "swing_daily"):
        return "swing"
    return None


def desk_today_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """
    GET ``/v1/desk/today`` — cached Opportunity Desk snapshot (discovery + movers radar).

    Query: ``mode=swing|day`` (default swing). Reads Upstash envelope written by scheduled batch.
    """
    _ = context
    mode = _parse_desk_mode(event)
    if mode is None:
        return bad_request("Invalid mode. Use swing or day.")

    key = opportunity_desk_redis_key(mode)
    envelope = read_dashboard_cache(key)
    if envelope is None:
        return ok(
            {
                "mode": mode,
                "source": "cache_miss",
                "envelope": None,
                "data": None,
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )

    data = envelope.get("data") if isinstance(envelope.get("data"), dict) else None
    return ok(
        {
            "mode": mode,
            "source": "cache",
            "envelope": envelope,
            "data": data,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def desk_refresh_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """
    POST ``/v1/desk/refresh`` — manual Tier B + C batch (scanner Lambda, 120s timeout).

    Per-user cooldown (5 min) via Upstash. Requires authenticated ``sub``.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Sign in to refresh the opportunity desk.")

    try:
        result = run_manual_desk_refresh(rc.user_id)
        return ok({**result, "disclaimer": API_SIGNAL_DISCLAIMER})
    except DeskRefreshCooldownError as exc:
        return too_many_requests(
            "Refresh desk is on cooldown. Try again shortly.",
            retry_after_seconds=exc.retry_after_seconds,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.exception("desk_refresh_failed user=%s", rc.user_id)
        return ok(
            {
                "status": "error",
                "message": str(exc)[:200],
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )