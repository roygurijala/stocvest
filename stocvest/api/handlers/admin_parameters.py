"""Admin HTTP handlers for the D10 Phase 4 parameter-rollback workflow.

Three routes under ``/v1/admin/parameters``:

* ``GET  /v1/admin/parameters/current`` — read-only snapshot of the live
  ``stocvest/signal-parameters`` secret as JSON. Powers the admin
  "current parameters" view on the parameters page.
* ``GET  /v1/admin/parameters/history`` — list prior versions for the
  rollback picker UI (newest first, with the currently-live row flagged).
* ``POST /v1/admin/parameters/rollback`` — body ``{target_version: str}``;
  rotates the live ``stocvest/signal-parameters`` secret to that prior
  version's payload and writes a fresh ``ParameterHistory`` audit row.

Both routes are gated by
:func:`stocvest.api.services.signal_analysis.analysis_authorized` —
exactly the same admin gate that protects the Phase-3 proposal review
routes and the audit endpoints.

Rollback is the **second** production code path (alongside Phase 3a's
promote) that mutates the live signal-parameters secret. The CloudWatch
alarm Lambda in Phase 4 only **reads** — the rollback button is the
operator's one-click answer to the alarm firing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from stocvest.api.response import bad_request, forbidden, internal_error, json_response, not_found, ok
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.parameter_rollback import (
    RollbackResult,
    list_history_with_live_marker,
    rollback_to_version,
)
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import signal_parameters_to_dict
from stocvest.data.models import AuditEvent
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

#: Default page size; the history table is tiny (one row per rotation)
#: so 50 is plenty for the picker UI.
_DEFAULT_HISTORY_LIMIT = 50
_MAX_HISTORY_LIMIT = 200


# ── Helpers ──────────────────────────────────────────────────────────────


def _query_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("queryStringParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _require_admin(event: LambdaEvent) -> dict[str, Any] | None:
    """Return a 403 response when the caller is not authorized; ``None`` when they are."""
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def _emit_audit(
    *,
    event: LambdaEvent,
    route: str,
    method: str,
    user_id: str | None,
    status_code: int,
    outcome: str,
    request_summary: dict[str, Any],
) -> None:
    """Best-effort audit emission — rollback is a high-value action."""
    try:
        headers = event.get("headers") if isinstance(event, dict) else {}
        session_id = (
            (headers or {}).get("x-stocvest-session-id")
            if isinstance(headers, dict)
            else None
        )
        get_audit_store().put_event(
            AuditEvent(
                event_id=str(uuid4()),
                occurred_at=datetime.now(timezone.utc),
                module="signals",
                route=route,
                method=method,
                path=str(event.get("path") or "") if isinstance(event, dict) else "",
                request_id=None,
                session_id=session_id if isinstance(session_id, str) else None,
                user_id=user_id,
                status_code=status_code,
                outcome=outcome,
                entitlement_snapshot={"admin_action": "parameter_rollback"},
                pricing_snapshot={},
                request_summary=request_summary,
            )
        )
    except Exception:  # pragma: no cover — audit failures must never block the response
        pass


# ── Handlers ─────────────────────────────────────────────────────────────


def admin_parameters_current_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/parameters/current`` — current live SignalParameters.

    Returns the full ``SignalParameters`` payload as JSON so the admin
    can inspect every weight / threshold / lookback that is currently
    driving the signal engines. This is the readable counterpart to the
    raw Secrets Manager blob — the same payload, deserialized through
    :func:`signal_parameters_to_dict`.

    Uses :meth:`ParameterStore.get_parameters_sync`, which has a 5-minute
    TTL cache — that's fine for an admin view (the cache is the same one
    every signal engine sees, so it represents "what's actually live").
    """
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    try:
        params = ParameterStore.get_parameters_sync()
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_parameters_current_handler failed: %s", exc)
        return internal_error("Failed to load current parameters.")
    return ok(
        {
            "version": params.version,
            "created_at": params.created_at,
            "notes": params.notes,
            "parameters": signal_parameters_to_dict(params),
        }
    )


def admin_parameters_history_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/parameters/history?limit=50`` — list prior versions."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    qp = _query_params(event)
    try:
        limit = int(qp.get("limit") or _DEFAULT_HISTORY_LIMIT)
    except ValueError:
        return bad_request("limit must be an integer")
    limit = max(1, min(_MAX_HISTORY_LIMIT, limit))

    try:
        rows = list_history_with_live_marker(limit=limit)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_parameters_history_handler failed: %s", exc)
        return json_response(
            500,
            {"error": "internal_error", "message": "Failed to list parameter history."},
        )
    return ok({"limit": limit, "items": [r.to_dict() for r in rows]})


def admin_parameters_rollback_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``POST /v1/admin/parameters/rollback`` — rotate live weights backward.

    Body schema (JSON): ``{"target_version": "1.0.3"}``.

    Returns:
        200 + :class:`RollbackResult` dict on success.
        400 if the body is malformed or ``target_version`` missing.
        404 if the version isn't in ``ParameterHistory``.
        409 if the target version is already live (no-op rollback).
        500 if the secret save fails or the audit row is corrupted.
    """
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    rc = build_request_context(event)

    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    target_version = body.get("target_version")
    if not isinstance(target_version, str) or not target_version.strip():
        return bad_request("target_version is required and must be a non-empty string.")
    target_version = target_version.strip()

    reviewer = rc.user_id or "unknown"

    result: RollbackResult = rollback_to_version(
        target_version,
        reviewed_by=reviewer,
    )

    status_code: int
    if result.success:
        status_code = 200
        outcome = "success"
    elif result.error == "not found":
        status_code = 404
        outcome = "failure"
    elif result.error == "already on target version":
        status_code = 409
        outcome = "failure"
    elif result.error == "target_version is required":
        status_code = 400
        outcome = "failure"
    else:
        status_code = 500
        outcome = "failure"

    _emit_audit(
        event=event,
        route="POST /v1/admin/parameters/rollback",
        method="POST",
        user_id=rc.user_id,
        status_code=status_code,
        outcome=outcome,
        request_summary={
            "action": "rollback",
            "target_version": target_version,
            "success": result.success,
            "new_parameter_version": result.new_parameter_version,
            "rolled_back_from": result.rolled_back_from,
            "error": result.error,
        },
    )

    if result.success:
        return ok(result.to_dict())
    if status_code == 404:
        return not_found(
            f"Parameter version {target_version!r} not found in history."
        )
    if status_code == 409:
        # Put the envelope keys AFTER the spread so the explicit error
        # envelope ("conflict") is never overwritten by the
        # RollbackResult's own ``error`` field — the spread carries the
        # detail (rolled_back_from / new_parameter_version etc.) under
        # its own ``result`` namespace.
        return json_response(
            409,
            {
                "result": result.to_dict(),
                "error": "conflict",
                "message": result.error or "Target version is already live.",
                "target_version": target_version,
                "rolled_back_from": result.rolled_back_from,
            },
        )
    if status_code == 400:
        return bad_request(result.error or "Invalid rollback request.")
    return json_response(
        500,
        {
            "result": result.to_dict(),
            "error": "internal_error",
            "message": result.error or "Rollback failed.",
            "target_version": target_version,
        },
    )
