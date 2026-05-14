"""Admin user-management HTTP handlers.

Five routes under ``/v1/admin/users``:

* ``GET    /v1/admin/users/search?q=&limit=`` — Cognito email-prefix search.
* ``GET    /v1/admin/users/{user_id}`` — Cognito + ``UserProfile`` + groups
  composition.
* ``POST   /v1/admin/users/{user_id}/reset-password`` — trigger Cognito
  ``AdminResetUserPassword`` so the user gets a fresh reset email.
* ``POST   /v1/admin/users/{user_id}/groups/{group}`` — add user to a
  whitelisted Cognito group (today: only ``signal-analytics-admin``).
* ``DELETE /v1/admin/users/{user_id}/groups/{group}`` — remove user from
  a whitelisted group.

All five gates through
:func:`stocvest.api.services.signal_analysis.analysis_authorized` so a
compromised non-admin JWT cannot reach any of them. The group endpoints
double-check the requested group is in
:data:`stocvest.api.services.admin_user_directory.ASSIGNABLE_GROUPS`
so a request for some unrelated group (e.g. ``cognito-idp:admin``) is
rejected at the handler layer — defense in depth even when the IAM
policy already restricts which groups the Lambda role can mutate.

Every mutation emits an :class:`AuditEvent` so an admin moderating other
admins shows up in the audit trail.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from stocvest.api.response import (
    bad_request,
    forbidden,
    internal_error,
    json_response,
    not_found,
    ok,
)
from stocvest.api.services.admin_user_directory import (
    ASSIGNABLE_GROUPS,
    AdminUserDetail,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    get_user_detail,
    list_users_page,
)
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.models import AuditEvent
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────


def _path_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("pathParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _query_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("queryStringParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _require_admin(event: LambdaEvent) -> dict[str, Any] | None:
    """Return a 403 response when the caller is not authorized; ``None`` otherwise."""
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def _require_cognito_pool() -> dict[str, Any] | None:
    """Return a structured 503 when ``COGNITO_USER_POOL_ID`` is unset.

    Previously the admin services swallowed a missing pool id and
    returned an empty page (``records=[]``), which the Admin Users UI
    rendered as the misleading copy "No users found in the pool yet."
    Production debugging of that regression cost us a round-trip — see
    ``docs/CONTEXT.md`` row 14 — so every admin handler that reaches
    into Cognito short-circuits *here* with an explicit, typed body
    instead. The frontend reads ``message`` / ``hint`` and surfaces
    them through ``AdminApiErrorCard``.

    The body shape mirrors the rest of the admin error vocabulary:
    ``error`` is a short code suitable for switch/case branching,
    ``message`` is the one-line summary the UI shows in bold, and
    ``hint`` is the actionable second line ("run terraform apply",
    "set $env:COGNITO_USER_POOL_ID=…").
    """
    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    if pool:
        return None
    _LOG.error(
        "admin handler invoked but COGNITO_USER_POOL_ID is empty — "
        "the function environment is missing the wiring added in "
        "infra/lambda_6e.tf (lambda_common_env). Run `terraform apply` "
        "from /infra and redeploy the API Lambda to pick it up."
    )
    return json_response(
        503,
        {
            "error": "config_error",
            "code": "cognito_pool_unset",
            "message": (
                "The backend cannot reach Cognito — COGNITO_USER_POOL_ID "
                "is not set on the API Lambda environment."
            ),
            "hint": (
                "Run `terraform apply` from /infra; the env var is wired "
                "in lambda_6e.tf under `lambda_common_env`. If you are "
                "running the API locally, export "
                "`COGNITO_USER_POOL_ID` before starting the dev server."
            ),
        },
    )


def _emit_audit(
    *,
    event: LambdaEvent,
    route: str,
    method: str,
    user_id: str | None,
    target_user_id: str,
    status_code: int,
    outcome: str,
    action: str,
    extra: dict[str, Any] | None = None,
) -> None:
    """Best-effort audit emission. Never blocks the response."""
    try:
        headers = event.get("headers") if isinstance(event, dict) else {}
        session_id = (
            (headers or {}).get("x-stocvest-session-id")
            if isinstance(headers, dict)
            else None
        )
        summary: dict[str, Any] = {"action": action, "target_user_id": target_user_id}
        if extra:
            summary.update(extra)
        get_audit_store().put_event(
            AuditEvent(
                event_id=str(uuid4()),
                occurred_at=datetime.now(timezone.utc),
                module="brokers",
                route=route,
                method=method,
                path=str(event.get("path") or "") if isinstance(event, dict) else "",
                request_id=None,
                session_id=session_id if isinstance(session_id, str) else None,
                user_id=target_user_id,
                status_code=status_code,
                outcome=outcome,
                entitlement_snapshot={"admin_action": action, "actor_user_id": user_id or ""},
                pricing_snapshot={},
                request_summary=summary,
            )
        )
    except Exception:  # pragma: no cover — audit failures must never block
        pass


def _build_cognito_client() -> Any | None:
    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    if not pool:
        return None
    region = (settings.cognito_region or settings.aws_region or "us-east-1").strip()
    try:
        import boto3

        return boto3.client("cognito-idp", region_name=region)
    except Exception as exc:  # pragma: no cover
        _LOG.warning("cognito client build failed: %s", exc)
        return None


# ── Read handlers ───────────────────────────────────────────────────────


def admin_users_search_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/users/search`` — list / search Cognito users.

    Query string parameters (all optional):

    * ``q``          — email prefix to filter on; empty (or omitted)
                       returns the full user pool, paginated.
    * ``limit``      — page size, clamped to ``[1, MAX_SEARCH_LIMIT]``.
                       Default ``25`` matches the Admin Users page
                       contract ("if more than 25, paginate").
    * ``page_token`` — opaque Cognito ``PaginationToken`` echoed back
                       from a previous response's ``next_token``.

    Response shape:

    .. code-block:: json

        {
          "query": "alice",
          "limit": 25,
          "items": [ ...summary rows... ],
          "next_token": "...opaque..." | null
        }

    ``next_token`` is ``null`` on the last page; clients should
    surface a "next page" affordance only when it's a non-empty
    string.
    """
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    misconfigured = _require_cognito_pool()
    if misconfigured is not None:
        return misconfigured

    qs = _query_params(event)
    query = (qs.get("q") or "").strip()
    try:
        limit = int(qs.get("limit") or DEFAULT_SEARCH_LIMIT)
    except ValueError:
        return bad_request("limit must be an integer.")
    limit = max(1, min(MAX_SEARCH_LIMIT, limit))
    page_token = (qs.get("page_token") or "").strip() or None

    page = list_users_page(query, limit=limit, page_token=page_token)
    store = get_user_profile_store()
    items: list[dict[str, Any]] = []
    for r in page.records:
        row = r.to_summary_dict()
        prof = store.get_profile(r.sub)
        row["subscription_plan"] = prof.subscription_plan
        row["last_active_at"] = prof.last_active_at
        items.append(row)
    return ok(
        {
            "query": query,
            "limit": limit,
            "items": items,
            "next_token": page.next_token,
        }
    )


def admin_users_detail_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/users/{user_id}`` — full per-user composite payload."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    misconfigured = _require_cognito_pool()
    if misconfigured is not None:
        return misconfigured

    user_id = _path_params(event).get("user_id", "").strip()
    if not user_id:
        return bad_request("user_id path parameter is required.")
    detail: AdminUserDetail | None = get_user_detail(user_id)
    if detail is None:
        return not_found(f"User {user_id!r} not found in Cognito.")
    return ok(detail.to_dict())


# ── Mutation handlers ───────────────────────────────────────────────────


def admin_users_reset_password_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``POST /v1/admin/users/{user_id}/reset-password`` — trigger Cognito reset.

    Cognito sends the user a "set new password" email (the same flow the
    Forgot Password button triggers). Useful when the user's reset email
    isn't arriving or they're locked out. Existing sessions remain valid
    until token expiry — this is a credential reset, not a session kill.
    """
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    misconfigured = _require_cognito_pool()
    if misconfigured is not None:
        return misconfigured
    rc = build_request_context(event)

    target_user_id = _path_params(event).get("user_id", "").strip()
    if not target_user_id:
        return bad_request("user_id path parameter is required.")

    detail = get_user_detail(target_user_id)
    if detail is None:
        return not_found(f"User {target_user_id!r} not found in Cognito.")

    client = _build_cognito_client()
    if client is None:
        _emit_audit(
            event=event,
            route="POST /v1/admin/users/{user_id}/reset-password",
            method="POST",
            user_id=rc.user_id,
            target_user_id=target_user_id,
            status_code=500,
            outcome="failure",
            action="reset_password",
            extra={"reason": "cognito_unconfigured"},
        )
        return internal_error("Cognito is not configured.")

    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    try:
        client.admin_reset_user_password(
            UserPoolId=pool,
            Username=detail.cognito.username,
        )
    except Exception as exc:
        _LOG.warning("admin_reset_user_password(%r) failed: %s", target_user_id, exc)
        _emit_audit(
            event=event,
            route="POST /v1/admin/users/{user_id}/reset-password",
            method="POST",
            user_id=rc.user_id,
            target_user_id=target_user_id,
            status_code=500,
            outcome="failure",
            action="reset_password",
            extra={"error": str(exc)},
        )
        return internal_error(f"Cognito reset failed: {exc}")

    _emit_audit(
        event=event,
        route="POST /v1/admin/users/{user_id}/reset-password",
        method="POST",
        user_id=rc.user_id,
        target_user_id=target_user_id,
        status_code=200,
        outcome="success",
        action="reset_password",
        extra={"username": detail.cognito.username},
    )
    return ok(
        {
            "user_id": target_user_id,
            "username": detail.cognito.username,
            "message": "Cognito password reset email triggered.",
        }
    )


def _validate_group(group: str) -> str | None:
    g = (group or "").strip()
    if not g:
        return "group path parameter is required."
    if g not in ASSIGNABLE_GROUPS:
        # Defense in depth — even if a future endpoint accidentally
        # widened the route, we still reject anything outside the
        # whitelist.
        return f"Group {g!r} is not assignable from the admin UI."
    return None


def _mutate_group(
    *,
    event: LambdaEvent,
    action: str,
    cognito_method: str,
) -> dict[str, Any]:
    deny = _require_admin(event)
    if deny is not None:
        return deny
    misconfigured = _require_cognito_pool()
    if misconfigured is not None:
        return misconfigured
    rc = build_request_context(event)

    target_user_id = _path_params(event).get("user_id", "").strip()
    if not target_user_id:
        return bad_request("user_id path parameter is required.")
    group = _path_params(event).get("group", "").strip()
    err = _validate_group(group)
    if err is not None:
        return bad_request(err)

    detail = get_user_detail(target_user_id)
    if detail is None:
        return not_found(f"User {target_user_id!r} not found in Cognito.")

    client = _build_cognito_client()
    if client is None:
        _emit_audit(
            event=event,
            route=f"{action.upper()} /v1/admin/users/{{user_id}}/groups/{{group}}",
            method="POST" if action == "add" else "DELETE",
            user_id=rc.user_id,
            target_user_id=target_user_id,
            status_code=500,
            outcome="failure",
            action=f"{action}_group:{group}",
            extra={"reason": "cognito_unconfigured"},
        )
        return internal_error("Cognito is not configured.")

    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    try:
        method = getattr(client, cognito_method)
        method(UserPoolId=pool, Username=detail.cognito.username, GroupName=group)
    except Exception as exc:
        _LOG.warning(
            "cognito %s(%r, %r) failed: %s",
            cognito_method,
            target_user_id,
            group,
            exc,
        )
        _emit_audit(
            event=event,
            route=f"{action.upper()} /v1/admin/users/{{user_id}}/groups/{{group}}",
            method="POST" if action == "add" else "DELETE",
            user_id=rc.user_id,
            target_user_id=target_user_id,
            status_code=500,
            outcome="failure",
            action=f"{action}_group:{group}",
            extra={"error": str(exc)},
        )
        return internal_error(f"Cognito group mutation failed: {exc}")

    _emit_audit(
        event=event,
        route=f"{action.upper()} /v1/admin/users/{{user_id}}/groups/{{group}}",
        method="POST" if action == "add" else "DELETE",
        user_id=rc.user_id,
        target_user_id=target_user_id,
        status_code=200,
        outcome="success",
        action=f"{action}_group:{group}",
        extra={"group": group, "username": detail.cognito.username},
    )
    refreshed = get_user_detail(target_user_id)
    payload: dict[str, Any] = {
        "user_id": target_user_id,
        "group": group,
        "action": action,
    }
    if refreshed is not None:
        payload["groups"] = list(refreshed.groups)
        payload["is_admin"] = refreshed.is_admin
    return json_response(200, payload)


def admin_users_add_group_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``POST /v1/admin/users/{user_id}/groups/{group}`` — add to whitelist group."""
    _ = context
    return _mutate_group(
        event=event,
        action="add",
        cognito_method="admin_add_user_to_group",
    )


def admin_users_remove_group_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``DELETE /v1/admin/users/{user_id}/groups/{group}`` — remove from group."""
    _ = context
    return _mutate_group(
        event=event,
        action="remove",
        cognito_method="admin_remove_user_from_group",
    )
