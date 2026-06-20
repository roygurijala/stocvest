"""Tracked trade plan endpoints — user-scoped frozen planning snapshots."""

from __future__ import annotations

from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, not_found, ok, unauthorized
from stocvest.api.services.tracked_plan_store import get_tracked_plan_store
from stocvest.api.services.tracked_plan_thesis_notify import process_tracked_plan_thesis_alerts
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import sanitize_free_text, sanitize_optional_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.signals.tracked_trade_plan import MAX_TRACKED_PLANS_PER_USER, TrackedTradePlan
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _plan_id_from_event(event: LambdaEvent) -> str | None:
    pp = event.get("pathParameters") or {}
    raw = pp.get("plan_id")
    if raw and not str(raw).startswith("{"):
        return str(raw).strip()
    rk = http_route_descriptor(event)
    for prefix in ("DELETE /v1/trade-plans/", "PUT /v1/trade-plans/"):
        if rk.startswith(prefix):
            rest = rk[len(prefix) :].split("?")[0].strip()
            if rest and not rest.startswith("{"):
                return rest
    return None


def trade_plans_list_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    plans = get_tracked_plan_store().list_plans(request_context.user_id)
    return ok([p.to_api() for p in plans])


def trade_plans_sync_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        raw_plans = payload.get("plans")
        if not isinstance(raw_plans, list):
            return bad_request("plans must be an array.")
        if len(raw_plans) > MAX_TRACKED_PLANS_PER_USER:
            return bad_request(f"At most {MAX_TRACKED_PLANS_PER_USER} plans allowed.")
        parsed: list[TrackedTradePlan] = []
        for row in raw_plans:
            if not isinstance(row, dict):
                return bad_request("Each plan must be an object.")
            parsed.append(_parse_plan_payload(row, user_id=request_context.user_id))
        store = get_tracked_plan_store()
        server = store.list_plans(request_context.user_id)
        merged = _merge_plans(server, tuple(parsed))
        store.replace_all(request_context.user_id, merged)
        return ok([p.to_api() for p in merged])
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid trade plan sync: {exc}")


def trade_plans_upsert_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        plan = _parse_plan_payload(payload, user_id=request_context.user_id)
        get_tracked_plan_store().upsert_plan(plan)
        return ok(plan.to_api())
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid trade plan upsert: {exc}")


def trade_plans_delete_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    plan_id = _plan_id_from_event(event)
    if not plan_id:
        return bad_request("plan_id is required.")
    removed = get_tracked_plan_store().remove_plan(request_context.user_id, plan_id)
    if not removed:
        return not_found("Trade plan not found.")
    return ok({"deleted": True, "id": plan_id})


def trade_plans_thesis_alerts_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        raw = payload.get("assessments")
        if not isinstance(raw, list):
            return bad_request("assessments must be an array.")
        sent = process_tracked_plan_thesis_alerts(
            user_id=request_context.user_id,
            assessments=raw,
        )
        return ok({"sent": sent})
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid thesis alerts request: {exc}")


def trade_plans_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    rk = http_route_descriptor(event)
    if rk == "GET /v1/trade-plans" or rk.startswith("GET /v1/trade-plans?"):
        return trade_plans_list_handler(event, context)
    if rk == "POST /v1/trade-plans/thesis-alerts":
        return trade_plans_thesis_alerts_handler(event, context)
    if rk == "PUT /v1/trade-plans/sync":
        return trade_plans_sync_handler(event, context)
    if rk == "PUT /v1/trade-plans":
        return trade_plans_upsert_handler(event, context)
    plan_id = _plan_id_from_event(event)
    if plan_id and rk.upper().startswith("DELETE"):
        return trade_plans_delete_handler(event, context)
    _LOG.warning("trade_plans_dispatch unknown route: %s", rk)
    return not_found(f"Unknown trade plans route: {rk or '(empty)'}")


def _merge_plans(
    server: tuple[TrackedTradePlan, ...],
    client: tuple[TrackedTradePlan, ...],
) -> tuple[TrackedTradePlan, ...]:
    """Per symbol+mode, keep the plan with the newest committedAt."""
    by_key: dict[str, TrackedTradePlan] = {}
    for p in (*server, *client):
        key = f"{p.mode}:{p.symbol}"
        cur = by_key.get(key)
        if cur is None or p.committed_at >= cur.committed_at:
            by_key[key] = p
    ordered = sorted(by_key.values(), key=lambda x: x.committed_at, reverse=True)
    return tuple(ordered[:MAX_TRACKED_PLANS_PER_USER])


def _parse_plan_payload(payload: dict[str, Any], *, user_id: str) -> TrackedTradePlan:
    if payload.get("userId") is not None or payload.get("user_id") is not None:
        raise ValueError("Do not submit user id; identity is taken from your session.")
    plan = TrackedTradePlan.from_api(user_id=user_id, payload=payload)
    verdict = plan.verdict_line
    if verdict:
        verdict = sanitize_optional_free_text(verdict, max_len=512)
    entry_q = plan.entry_zone_quality
    if entry_q:
        entry_q = sanitize_free_text(entry_q, max_len=64)
    return TrackedTradePlan(
        plan_id=plan.plan_id,
        user_id=user_id,
        symbol=plan.symbol,
        mode=plan.mode,
        committed_at=plan.committed_at,
        bias=plan.bias,
        levels=plan.levels,
        expires_at=plan.expires_at,
        layers_aligned=plan.layers_aligned,
        layers_total=plan.layers_total,
        entry_zone_quality=entry_q,
        parameter_version=plan.parameter_version,
        verdict_line=verdict,
        desk_min_rr=plan.desk_min_rr,
    )
