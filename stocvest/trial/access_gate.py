"""HTTP API gate when trial enforcement is enabled."""

from __future__ import annotations

from typing import Any

from stocvest.api.response import json_response
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaEvent
from stocvest.trial.access import resolve_access
from stocvest.utils.config import get_settings


# Routes that remain reachable when phone verification or trial expiry blocks full access.
TRIAL_EXEMPT_ROUTES: frozenset[str] = frozenset(
    {
        "GET /v1/health",
        "GET /v1/users/me",
        "PATCH /v1/users/me",
        "POST /v1/users/me/phone/request-code",
        "POST /v1/users/me/phone/verify-code",
    }
)


def _caller_is_admin(event: LambdaEvent) -> bool:
    from stocvest.api.services.signal_analysis import analysis_authorized

    rc = build_request_context(event)
    if not rc.user_id:
        return False
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    return analysis_authorized(
        user_id=rc.user_id,
        claims=rc.claims if isinstance(rc.claims, dict) else {},
        headers=headers,
    )


def trial_gate_response(event: LambdaEvent, route: str) -> dict[str, Any] | None:
    """Return a 403 response when trial enforcement blocks this route, else None."""
    settings = get_settings()
    if not settings.trial_enforcement_enabled:
        return None
    if route in TRIAL_EXEMPT_ROUTES:
        return None

    rc = build_request_context(event)
    if not rc.user_id:
        return None
    if _caller_is_admin(event):
        return None

    profile = get_user_profile_store().get_profile(rc.user_id)
    snap = resolve_access(profile, is_admin=False)
    if snap.access_state == "phone_required":
        return json_response(
            403,
            {
                "error": "phone_verification_required",
                "message": "Verify your phone number to continue.",
                "access_state": snap.access_state,
            },
        )
    if snap.access_state == "trial_expired":
        return json_response(
            403,
            {
                "error": "trial_expired",
                "message": "Your trial has ended. Upgrade to continue.",
                "access_state": snap.access_state,
            },
        )
    return None
