"""Admin audit-log read handlers.

Single route under ``/v1/admin/audit/recent``:

* ``GET /v1/admin/audit/recent?limit=&module=&route_prefix=`` — global
  feed of the newest :class:`AuditEvent` rows across every user
  partition, sorted by ``occurred_at`` descending.

The per-user (``GET /v1/admin/audit/users/{user_id}``) and per-session
endpoints already live in :mod:`stocvest.api.handlers.orders` — this
module ships only the **global** feed because that's what the admin hub
audit page needs and the existing handlers do not provide.

The implementation goes through :meth:`AuditStore.list_recent_events`
which is intentionally a bounded ``Scan`` (the table is keyed by user
partition with no time-ordered GSI; adding one for this rarely-used
admin view would be over-engineering). Server-side ``FilterExpression``
clauses keep the wire payload small when the admin is hunting for a
specific module or route.
"""

from __future__ import annotations

from typing import Any

from stocvest.api.response import bad_request, forbidden, internal_error, ok
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_RECENT_LIMIT = 100
_MAX_RECENT_LIMIT = 500


def _query_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("queryStringParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _require_admin(event: LambdaEvent) -> dict[str, Any] | None:
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def admin_audit_recent_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/audit/recent`` — global newest-first audit feed."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    qs = _query_params(event)
    try:
        limit = int(qs.get("limit") or _DEFAULT_RECENT_LIMIT)
    except ValueError:
        return bad_request("limit must be an integer.")
    limit = max(1, min(_MAX_RECENT_LIMIT, limit))

    module = (qs.get("module") or "").strip() or None
    route_prefix = (qs.get("route_prefix") or "").strip() or None

    try:
        rows = get_audit_store().list_recent_events(
            limit=limit,
            module=module,
            route_prefix=route_prefix,
        )
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_audit_recent_handler failed: %s", exc)
        return internal_error("Failed to list audit events.")

    return ok(
        {
            "limit": limit,
            "module": module,
            "route_prefix": route_prefix,
            "items": [r.model_dump(mode="json") for r in rows],
        }
    )
