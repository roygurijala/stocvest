"""POST /v1/users/me/phone/request-code and verify-code."""

from __future__ import annotations

from typing import Any

from stocvest.api.response import bad_request, forbidden, json_response, ok, unauthorized
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.trial.phone_service import PhoneVerificationError, request_phone_code, verify_phone_code


def _error_response(exc: PhoneVerificationError) -> dict[str, Any]:
    code = exc.code
    if code == "rate_limited":
        return json_response(429, {"error": "rate_limited", "message": str(exc)})
    if code == "forbidden":
        return forbidden(str(exc))
    if code == "conflict":
        return json_response(409, {"error": "conflict", "message": str(exc)})
    if code == "internal_error":
        return json_response(500, {"error": "internal_error", "message": str(exc)})
    return bad_request(str(exc))


def users_me_phone_request_code_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Invalid JSON body.")

    phone = body.get("phone_e164") or body.get("phone")
    sms_opt_in = bool(body.get("sms_opt_in") or body.get("sms_marketing_opt_in"))

    store = get_user_profile_store()
    profile = store.get_profile(request_context.user_id)
    try:
        result = request_phone_code(
            user_id=request_context.user_id,
            profile=profile,
            phone_raw=str(phone or ""),
            sms_opt_in=sms_opt_in,
            store=store,
        )
    except PhoneVerificationError as exc:
        return _error_response(exc)
    return ok(result)


def users_me_phone_verify_code_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Invalid JSON body.")

    code = body.get("code") or body.get("otp")
    store = get_user_profile_store()
    profile = store.get_profile(request_context.user_id)
    try:
        result = verify_phone_code(
            user_id=request_context.user_id,
            profile=profile,
            code_raw=str(code or ""),
            store=store,
            is_admin=False,
        )
    except PhoneVerificationError as exc:
        return _error_response(exc)

    from stocvest.api.handlers.orders import _serialize_user_profile

    payload = _serialize_user_profile(result.profile, is_admin=False)
    payload["access"] = result.access
    return ok(payload)
