"""Laggard intelligence HTTP handlers (Chunk 8)."""

from __future__ import annotations

from typing import Any, cast

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, forbidden, ok, unauthorized
from stocvest.api.services.laggard_api import (
    ConfidenceFilter,
    DriverFilter,
    TypeFilter,
    get_symbol_laggard_payload_sync,
    laggard_plan_allowed,
    scan_laggards_sync,
)
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent


def _path_symbol(event: LambdaEvent) -> str:
    pp = event.get("pathParameters") or {}
    if isinstance(pp, dict) and pp.get("symbol"):
        return str(pp["symbol"]).strip().upper()
    route = http_route_descriptor(event)
    if route.startswith("GET /v1/signals/") and route.endswith("/laggard"):
        middle = route[len("GET /v1/signals/") : -len("/laggard")]
        return middle.strip().upper()
    return ""


def _qs(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("queryStringParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def signal_laggard_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/{symbol}/laggard — swing laggard context (paid plans)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authentication required.")
    if not laggard_plan_allowed(rc.user_id):
        return forbidden("Swing Pro or Swing Day Pro subscription required for laggard intelligence.")

    sym = _path_symbol(event)
    if not sym:
        return bad_request("Path parameter 'symbol' is required.")

    qs = _qs(event)
    mode = str(qs.get("mode") or "swing").strip().lower()
    body = get_symbol_laggard_payload_sync(sym, mode=mode, user_id=rc.user_id)
    return ok(body)


def scanner_laggards_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/scanner/laggards — scan warmed universe for laggards (paid plans)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authentication required.")
    if not laggard_plan_allowed(rc.user_id):
        return forbidden("Swing Pro or Swing Day Pro subscription required for laggard intelligence.")

    qs = _qs(event)
    confidence = cast(ConfidenceFilter, str(qs.get("confidence") or "medium").strip().lower())
    if confidence not in ("high", "medium", "all"):
        return bad_request("confidence must be high, medium, or all.")

    laggard_type = cast(TypeFilter, str(qs.get("type") or "all").strip().lower())
    if laggard_type not in ("catch_up", "pre_breakout", "distribution", "all"):
        return bad_request("type must be catch_up, pre_breakout, distribution, or all.")

    driver = cast(DriverFilter, str(qs.get("driver") or "all").strip().lower())
    if driver not in ("sector", "theme", "macro", "pre_ipo", "all"):
        return bad_request("driver must be sector, theme, macro, pre_ipo, or all.")

    body = scan_laggards_sync(
        user_id=rc.user_id,
        confidence=confidence,
        laggard_type=laggard_type,
        driver=driver,
    )
    return ok(body)
