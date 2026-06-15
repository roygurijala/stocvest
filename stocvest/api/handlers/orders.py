"""Order validation, submission with safety gates, status, and trading-mode profile."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.broker_gateway_provider import DEFAULT_BROKER_GATEWAY_PROVIDER, BrokerGatewayProvider
from stocvest.api.response import bad_request, json_response, ok, unauthorized
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.services.journal_order_hooks import apply_journal_after_order_submit
from stocvest.api.services.order_safety import OrderAccountState, OrderSafetyGate
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import sanitize_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.brokers import (
    BrokerAdapterFactory,
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRateLimitError,
    BrokerRejectedError,
    BrokerUnavailableError,
    InsufficientFundsError,
    MarketClosedError,
    OrderQuantityLimitError,
    OrderRejectedError,
    PDTViolationError,
    PlaceOrderRequest,
    UnknownSymbolError,
)
from stocvest.config.beta_access import default_beta_access_until_iso
from stocvest.data import PolygonClient
from stocvest.data.models import TradingMode, UserProfile
from stocvest.data.models import AuditEvent
from stocvest.trial.access import resolve_access
from stocvest.utils.config import get_settings
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger
from uuid import uuid4

_LOG = get_logger(__name__)


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    return {str(k): str(v) for k, v in query.items() if v is not None}


def _path_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("pathParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _validation_dict(result: Any) -> dict[str, Any]:
    if dataclasses.is_dataclass(result):
        return dataclasses.asdict(result)
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return {}


def _run_order_op(fn: Any) -> dict[str, Any]:
    try:
        return asyncio.run(fn())
    except PDTViolationError as exc:
        return json_response(403, {"error": "pdt_violation", "message": str(exc)})
    except InsufficientFundsError as exc:
        return json_response(403, {"error": "insufficient_funds", "message": str(exc)})
    except MarketClosedError as exc:
        return json_response(403, {"error": "market_closed", "message": str(exc)})
    except UnknownSymbolError as exc:
        return json_response(400, {"error": "unknown_symbol", "message": str(exc)})
    except OrderQuantityLimitError as exc:
        return json_response(400, {"error": "quantity_limit", "message": str(exc)})
    except OrderRejectedError as exc:
        payload: dict[str, Any] = {"error": "order_rejected", "message": str(exc)}
        if exc.validation_result is not None:
            payload["validation"] = _validation_dict(exc.validation_result)
        return json_response(400, payload)
    except BrokerAuthError as exc:
        return json_response(401, {"error": "unauthorized", "message": str(exc)})
    except BrokerNotFoundError as exc:
        return json_response(404, {"error": "not_found", "message": str(exc)})
    except BrokerRateLimitError as exc:
        return json_response(429, {"error": "rate_limited", "message": str(exc)})
    except BrokerRejectedError as exc:
        return json_response(403, {"error": "forbidden", "message": str(exc)})
    except BrokerUnavailableError as exc:
        return json_response(503, {"error": "unavailable", "message": str(exc)})
    except ValueError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return json_response(500, {"error": "internal_error", "message": str(exc)})


def orders_validate_handler(
    event: LambdaEvent,
    context: LambdaContext,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    _ = gateway_provider
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        request = _parse_order_body(body)
        account_state = _account_state_from_body(body, user_id=request_context.user_id)
    except Exception as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            gate = OrderSafetyGate(client)
            result = await gate.validate_order(request_context.user_id, request, account_state)
        return ok(_validation_dict(result))

    resp = _run_order_op(_run)
    if resp.get("statusCode") == 200 and request_context.email and request_context.user_id:
        try:
            payload = json.loads(resp.get("body") or "{}")
        except json.JSONDecodeError:
            payload = {}
        try:
            used = int(payload.get("pdt_trades_used") or 0)
        except (TypeError, ValueError):
            used = 0
        if used == 2:
            from stocvest.api.services.alert_tasks import run_alert_background
            from stocvest.services.alert_trigger import get_alert_trigger

            uid = request_context.user_id
            em = request_context.email
            run_alert_background(
                lambda: get_alert_trigger().trigger_pdt_alert(
                    user_id=uid or "",
                    user_email=em or "",
                    trades_used=2,
                )
            )
    return resp


def orders_submit_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        if body.get("confirmed") is not True:
            return bad_request("confirmed must be true to submit an order.")
        signal_context = {
            k: body.get(k)
            for k in ("signal_id", "signal_strength", "confluence_score", "pattern", "signal_direction")
            if body.get(k) is not None
        }
        request = _parse_order_body(body)
        broker = str(body.get("broker") or "mock").strip().lower()
        account_id = str(body.get("account_id") or "").strip()
        if broker not in {"mock", "ibkr", "etrade"}:
            return bad_request("broker must be mock, ibkr, or etrade.")
        if not account_id:
            return bad_request("account_id is required.")
        account_state = _account_state_from_body(body, user_id=request_context.user_id)
    except Exception as exc:
        return bad_request(str(exc))

    profile = get_user_profile_store().get_profile(request_context.user_id)
    paper = profile.trading_mode == TradingMode.PAPER
    if paper:
        broker = "mock"

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            gate = OrderSafetyGate(client)
            connect_config = gateway_provider.build_connect_config(broker)
            connect_config["order_safety_gate"] = gate
            connect_config["order_safety_user_id"] = request_context.user_id
            connect_config["order_safety_account_state"] = account_state
            adapter = factory.create(broker)
            try:
                await adapter.connect(connect_config)
                ack = await adapter.place_order(account_id, request)
                await apply_journal_after_order_submit(
                    user_id=request_context.user_id,
                    broker=broker,
                    account_id=account_id,
                    request=request,
                    ack=ack,
                    adapter=adapter,
                    signal_context=signal_context or None,
                    is_day_trade=account_state.is_day_trade,
                )
            finally:
                await adapter.disconnect()
        _LOG.info(
            "order_submit_ok user=%s symbol=%s side=%s qty=%s mode=%s",
            user_ref_for_logs(request_context.user_id),
            request.symbol,
            request.side.value,
            request.quantity,
            "paper" if paper else "live",
        )
        return ok(ack.model_dump(mode="json"))

    resp = _run_order_op(_run)
    if resp.get("statusCode") == 403 and request_context.email and request_context.user_id:
        try:
            body = json.loads(resp.get("body") or "{}")
        except json.JSONDecodeError:
            body = {}
        if body.get("error") == "pdt_violation":
            from stocvest.api.services.alert_tasks import run_alert_background
            from stocvest.services.alert_trigger import get_alert_trigger

            uid = request_context.user_id
            em = request_context.email
            run_alert_background(
                lambda: get_alert_trigger().trigger_pdt_alert(
                    user_id=uid or "",
                    user_email=em or "",
                    trades_used=3,
                )
            )
    return resp


def orders_status_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    path = _path_params(event)
    order_id = str(path.get("order_id") or "").strip()
    if not order_id:
        return bad_request("order_id path parameter is required.")
    query = _query_params(event)
    broker = str(query.get("broker") or "").strip().lower()
    account_id = str(query.get("account_id") or "").strip()
    if broker not in {"mock", "ibkr", "etrade"}:
        return bad_request("Query param broker is required.")
    if not account_id:
        return bad_request("Query param account_id is required.")

    async def _run() -> dict[str, Any]:
        connect_config = gateway_provider.build_connect_config(broker)
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            status = await adapter.get_order(account_id, order_id)
        finally:
            await adapter.disconnect()
        return ok(status.model_dump(mode="json"))

    return _run_order_op(_run)


def _serialize_user_profile(
    profile: UserProfile,
    *,
    is_admin: bool = False,
) -> dict[str, Any]:
    """Serialize a ``UserProfile`` for the ``GET /v1/users/me`` response.

    ``is_admin`` is set by callers that have admin-claims context for
    **this** user (the one whose profile is being returned). When ``True``
    we OR-bump ``has_full_access`` and ``has_ai_explanations`` so an admin
    transparently gets every paid feature regardless of their subscription
    plan or beta flag — admins are the safety net, so they need the
    superset of all capabilities while inspecting the app.

    For handlers where the caller is an admin viewing **another** user's
    profile (``admin_beta_access_patch_handler``) ``is_admin`` is left
    ``False``: bumping the target's flags based on the actor's group
    would be a privilege confusion bug.
    """
    snap = resolve_access(profile, is_admin=is_admin)
    return {
        "user_id": profile.user_id,
        "first_name": profile.first_name,
        "last_name": profile.last_name,
        "trading_mode": profile.trading_mode.value,
        "onboarding_completed": profile.onboarding_completed,
        "onboarding_completed_at": profile.onboarding_completed_at,
        "legal_acknowledged": profile.legal_acknowledged,
        "legal_acknowledged_at": profile.legal_acknowledged_at,
        "legal_acknowledged_version": profile.legal_acknowledged_version,
        "subscription_plan": profile.subscription_plan,
        "beta_full_access": profile.beta_full_access,
        "beta_access_until": profile.beta_access_until,
        "beta_access_granted_at": profile.beta_access_granted_at,
        "has_full_access": snap.has_full_access,
        "has_ai_explanations": snap.has_ai_explanations,
        "is_admin": is_admin,
        "access_state": snap.access_state,
        "trial_days_remaining": snap.trial_days_remaining,
        "phone_verified": snap.phone_verified,
        "phone_last4": snap.phone_last4,
        "trial_started_at": snap.trial_started_at,
        "trial_ends_at": snap.trial_ends_at,
        "trial_enforcement_enabled": snap.trial_enforcement_enabled,
    }


def _caller_is_admin(event: LambdaEvent, request_context: Any) -> bool:
    """Compute the admin flag for the caller in one place.

    Same gate as ``analysis_authorized()`` so the entitlement bump and
    the admin-only endpoints stay in lockstep — there is no way to be
    "admin for nav" without also being "admin for backend".
    """
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    return analysis_authorized(
        user_id=request_context.user_id,
        claims=request_context.claims,
        headers=headers,
    )


def _touch_last_active_if_stale(store: Any, profile: UserProfile) -> UserProfile:
    """Persist ``last_active_at`` at most once per five minutes per user."""
    raw = (profile.last_active_at or "").strip()
    now = datetime.now(timezone.utc)
    should_touch = True
    if raw:
        try:
            last = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            should_touch = (now - last) > timedelta(minutes=5)
        except ValueError:
            should_touch = True
    if not should_touch:
        return profile
    merged = profile.model_copy(update={"last_active_at": now.isoformat()})
    store.put_profile(merged)
    return merged


def users_me_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    store = get_user_profile_store()
    profile = store.get_profile(request_context.user_id)
    if request_context.email and not (profile.email or "").strip():
        profile = profile.model_copy(update={"email": request_context.email.strip()})
        store.put_profile(profile)
    profile = _touch_last_active_if_stale(store, profile)
    is_admin = _caller_is_admin(event, request_context)
    return ok(_serialize_user_profile(profile, is_admin=is_admin))


def users_me_patch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    # Billing-only field; ignore if client sends it.
    if isinstance(body, dict):
        blocked = {
            "subscription_plan",
            "beta_full_access",
            "beta_access_until",
            "beta_access_granted_at",
            "phone_verified",
            "phone_verified_at",
            "phone_hmac",
            "phone_last4",
            "sms_marketing_opt_in",
            "trial_started_at",
            "trial_ends_at",
            "trial_reminder_day10_sent_at",
            "trial_reminder_day14_sent_at",
        }
        if any(k in body for k in blocked):
            body = {k: v for k, v in body.items() if k not in blocked}
    store = get_user_profile_store()
    cur = store.get_profile(request_context.user_id)
    updates: dict[str, Any] = {}

    if "first_name" in body:
        raw_name = body.get("first_name")
        if raw_name is None or str(raw_name).strip() == "":
            updates["first_name"] = None
        else:
            cleaned = sanitize_free_text(raw_name, max_len=60)
            updates["first_name"] = cleaned or None

    if "last_name" in body:
        raw_last = body.get("last_name")
        if raw_last is None or str(raw_last).strip() == "":
            updates["last_name"] = None
        else:
            cleaned = sanitize_free_text(raw_last, max_len=60)
            updates["last_name"] = cleaned or None

    if "trading_mode" in body:
        try:
            updates["trading_mode"] = TradingMode(str(body["trading_mode"]).strip().lower())
        except ValueError:
            return bad_request("trading_mode must be 'paper' or 'live'.")

    if "onboarding_completed" in body:
        updates["onboarding_completed"] = bool(body["onboarding_completed"])
        if updates["onboarding_completed"]:
            raw_at = body.get("onboarding_completed_at")
            updates["onboarding_completed_at"] = (
                str(raw_at).strip()
                if raw_at
                else datetime.now(timezone.utc).isoformat()
            )
        else:
            updates["onboarding_completed_at"] = None

    if "legal_acknowledged" in body:
        ack = bool(body["legal_acknowledged"])
        updates["legal_acknowledged"] = ack
        if ack:
            ver = body.get("legal_acknowledged_version")
            ver_clean = sanitize_free_text(ver, max_len=64) if ver is not None else ""
            if not ver_clean:
                return bad_request("legal_acknowledged_version is required when acknowledging.")
            updates["legal_acknowledged_version"] = ver_clean
            raw_at = body.get("legal_acknowledged_at")
            updates["legal_acknowledged_at"] = (
                str(raw_at).strip()
                if raw_at
                else datetime.now(timezone.utc).isoformat()
            )
        else:
            updates["legal_acknowledged_at"] = None
            updates["legal_acknowledged_version"] = None

    is_admin = _caller_is_admin(event, request_context)
    if not updates:
        return ok(_serialize_user_profile(cur, is_admin=is_admin))

    merged = cur.model_copy(update=updates)
    store.put_profile(merged)
    return ok(_serialize_user_profile(merged, is_admin=is_admin))


def admin_beta_access_patch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """PATCH /v1/admin/users/{user_id}/beta-access — grant/revoke full beta access per user."""
    _ = context
    request_context = build_request_context(event)
    headers = event.get("headers") or {}
    if not analysis_authorized(user_id=request_context.user_id, claims=request_context.claims, headers=headers):
        return json_response(403, {"error": "forbidden", "message": "Admin authorization required."})
    target_user_id = _path_params(event).get("user_id", "").strip()
    if not target_user_id:
        return bad_request("user_id path parameter is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if "enabled" not in body:
        return bad_request("enabled is required.")
    enabled = bool(body.get("enabled"))
    indefinite = bool(body.get("indefinite")) or bool(body.get("no_expiry"))
    raw_until = body.get("until")
    until = str(raw_until).strip() if raw_until is not None else None
    if until == "":
        until = None
    if enabled and indefinite and until is not None:
        return bad_request("Do not pass both until and indefinite.")
    effective_until: str | None = None
    if enabled:
        if indefinite:
            effective_until = None
        elif until is not None:
            effective_until = until
        else:
            effective_until = default_beta_access_until_iso()
    store = get_user_profile_store()
    cur = store.get_profile(target_user_id)
    merged = cur.model_copy(
        update={
            "beta_full_access": enabled,
            "beta_access_until": effective_until,
            "beta_access_granted_at": datetime.now(timezone.utc).isoformat() if enabled else None,
        }
    )
    store.put_profile(merged)
    try:
        get_audit_store().put_event(
            AuditEvent(
                event_id=str(uuid4()),
                occurred_at=datetime.now(timezone.utc),
                module="brokers",
                route="PATCH /v1/admin/users/{user_id}/beta-access",
                method="PATCH",
                path=str(event.get("path") or ""),
                request_id=request_context.request_id or None,
                session_id=(event.get("headers") or {}).get("x-stocvest-session-id") if isinstance(event.get("headers"), dict) else None,
                user_id=target_user_id,
                status_code=200,
                outcome="success",
                entitlement_snapshot={
                    "subscription_plan": merged.subscription_plan,
                    "beta_full_access": merged.beta_full_access,
                    "beta_access_until": merged.beta_access_until,
                    "has_full_access": merged.has_full_access,
                    "has_ai_explanations": merged.has_ai_explanations,
                },
                pricing_snapshot={"admin_action": "beta_access_toggle"},
                request_summary={
                    "enabled": enabled,
                    "until": effective_until,
                    "until_client_supplied": until is not None,
                    "indefinite": indefinite,
                },
                response_summary={"message": "beta access updated"},
                market_snapshot={},
            )
        )
    except Exception:
        pass
    return ok(_serialize_user_profile(merged))


def admin_audit_user_events_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return json_response(403, {"error": "forbidden", "message": "Admin authorization required."})
    user_id = _path_params(event).get("user_id", "").strip()
    if not user_id:
        return bad_request("user_id path parameter is required.")
    qs = _query_params(event)
    try:
        limit = max(1, min(500, int(qs.get("limit") or "200")))
    except ValueError:
        limit = 200
    rows = get_audit_store().get_user_events(user_id, limit=limit)
    return ok([r.model_dump(mode="json") for r in rows])


def admin_audit_session_events_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return json_response(403, {"error": "forbidden", "message": "Admin authorization required."})
    session_id = _path_params(event).get("session_id", "").strip()
    if not session_id:
        return bad_request("session_id path parameter is required.")
    qs = _query_params(event)
    try:
        limit = max(1, min(500, int(qs.get("limit") or "200")))
    except ValueError:
        limit = 200
    rows = get_audit_store().get_session_events(session_id, limit=limit)
    return ok([r.model_dump(mode="json") for r in rows])


def profile_trading_mode_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    profile = get_user_profile_store().get_profile(request_context.user_id)
    return ok({"user_id": profile.user_id, "trading_mode": profile.trading_mode.value})


def profile_trading_mode_post_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        raw = str(body.get("trading_mode") or "").strip().lower()
        mode = TradingMode(raw)
    except ValueError:
        return bad_request("trading_mode must be 'paper' or 'live'.")
    store = get_user_profile_store()
    cur = store.get_profile(request_context.user_id)
    store.put_profile(cur.model_copy(update={"trading_mode": mode}))
    return ok({"trading_mode": mode.value})


def _parse_order_body(body: dict[str, Any]) -> PlaceOrderRequest:
    data = dict(body)
    cid = data.get("client_order_id")
    if not cid or not str(cid).strip():
        data["client_order_id"] = f"ord-{uuid.uuid4().hex[:16]}"
    return PlaceOrderRequest.model_validate(data)


def _account_state_from_body(body: dict[str, Any], *, user_id: str) -> OrderAccountState:
    profile = get_user_profile_store().get_profile(user_id)
    paper = profile.trading_mode == TradingMode.PAPER
    cash_raw = body.get("available_cash")
    if cash_raw is None:
        available_cash = float("inf") if paper else 0.0
    else:
        available_cash = float(cash_raw)
    is_day_trade = bool(body.get("is_day_trade", True))
    pdt_state = get_pdt_state_store().get_state(user_id)
    return OrderAccountState(
        trading_mode_is_paper=paper,
        available_cash=available_cash,
        is_day_trade=is_day_trade,
        pdt_state=pdt_state,
    )
