"""Capture immutable audit events for API actions and replay."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaEvent
from stocvest.data.models import AuditEvent


_REDACT_KEYS = {"authorization", "password", "token", "secret", "cookie", "set-cookie", "id_token", "access_token"}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            ks = str(k).lower()
            if ks in _REDACT_KEYS:
                out[str(k)] = "[REDACTED]"
                continue
            out[str(k)] = _redact(v)
        return out
    if isinstance(value, list):
        return [_redact(v) for v in value[:30]]
    if isinstance(value, str):
        return value if len(value) <= 600 else f"{value[:600]}...[truncated]"
    return value


def _pricing_snapshot(subscription_plan: str) -> dict[str, object]:
    plan = (subscription_plan or "free").strip().lower()
    if plan == "swing_pro":
        return {"plan": "swing_pro", "display_monthly_usd": 29, "regular_monthly_usd": 49, "founding_offer": True}
    if plan == "swing_day_pro":
        return {"plan": "swing_day_pro", "display_monthly_usd": 59, "regular_monthly_usd": 99, "founding_offer": True}
    return {"plan": "free", "display_monthly_usd": 0, "regular_monthly_usd": 0, "founding_offer": False}


def _json_body(resp: dict[str, Any]) -> dict[str, Any]:
    raw = resp.get("body")
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _request_body(event: LambdaEvent) -> dict[str, Any]:
    try:
        body = parse_json_body(event)
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


def _market_snapshot_from_request(body: dict[str, Any]) -> dict[str, Any]:
    snap: dict[str, Any] = {}
    for k in (
        "symbol",
        "regime",
        "price_at_signal",
        "signal_strength",
        "pattern",
        "vix",
        "spy_day_pct",
        "qqq_day_pct",
    ):
        if k in body:
            snap[k] = body.get(k)
    ss = body.get("symbol_snapshot")
    if isinstance(ss, dict):
        for k in ("last_trade_price", "day_vwap", "day_volume", "prev_close", "market_status"):
            if k in ss:
                snap[f"snapshot_{k}"] = ss.get(k)
    return snap


def capture_http_audit_event(*, event: LambdaEvent, response: dict[str, Any], module: str, extra_market: dict[str, Any] | None = None) -> None:
    """Best-effort audit write; never raises into API flow."""
    try:
        route = http_route_descriptor(event)
        if route.startswith("GET /v1/admin/audit/"):
            return
        rc = build_request_context(event)
        hdr = event.get("headers") or {}
        headers = {str(k).lower(): str(v) for k, v in hdr.items()} if isinstance(hdr, dict) else {}
        session_id = headers.get("x-stocvest-session-id") or rc.request_id or str(uuid4())
        method = str(event.get("httpMethod") or "")
        path = str(event.get("path") or "")
        req_body = _request_body(event)
        resp_body = _json_body(response)
        status_code = int(response.get("statusCode") or 0)
        outcome = "success" if 200 <= status_code < 300 else "error"
        profile = get_user_profile_store().get_profile(rc.user_id) if rc.user_id else None
        entitlement = (
            {
                "subscription_plan": profile.subscription_plan,
                "beta_full_access": profile.beta_full_access,
                "beta_access_until": profile.beta_access_until,
                "has_full_access": profile.has_full_access,
                "has_ai_explanations": profile.has_ai_explanations,
            }
            if profile
            else {}
        )
        pricing = _pricing_snapshot(profile.subscription_plan) if profile else {"plan": "anonymous"}
        market_snapshot = _market_snapshot_from_request(req_body)
        if extra_market:
            market_snapshot.update(_redact(extra_market))
        evt = AuditEvent(
            event_id=str(uuid4()),
            occurred_at=datetime.now(timezone.utc),
            module=module,
            route=route,
            method=method,
            path=path,
            request_id=rc.request_id or None,
            session_id=session_id,
            user_id=rc.user_id,
            status_code=status_code,
            outcome=outcome,
            entitlement_snapshot=entitlement,
            pricing_snapshot=pricing,
            request_summary=_redact({"query": event.get("queryStringParameters") or {}, "body": req_body}),
            response_summary=_redact({"error": resp_body.get("error"), "message": resp_body.get("message")}),
            market_snapshot=_redact(market_snapshot),
        )
        get_audit_store().put_event(evt)
    except Exception:
        return
