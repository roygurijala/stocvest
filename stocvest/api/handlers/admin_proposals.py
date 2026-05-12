"""Admin HTTP handlers for the D10 Phase 3 proposal-review workflow.

Four routes under ``/v1/admin/proposals``:

* ``GET  /v1/admin/proposals?status=pending`` — list summary rows
* ``GET  /v1/admin/proposals/{proposal_id}`` — detail with full evidence
* ``POST /v1/admin/proposals/{proposal_id}/promote`` — rotate live weights
* ``POST /v1/admin/proposals/{proposal_id}/reject`` — reject with note

All four routes require admin authorization via
:func:`stocvest.api.services.signal_analysis.analysis_authorized` — the
same gate that protects the existing admin beta-access + audit
endpoints. There is no "viewer" tier: reading proposal evidence is
considered admin-only because the data exposes internal optimization
metrics that we don't want leaking via accidental anonymous access.

Promotion is the only path in the codebase that mutates the live
``stocvest/signal-parameters`` Secrets Manager secret under admin
authority — that's the entire reason D10 exists (the scheduled worker
in Phase 2b is read-only on the secret by design). Every successful
promotion writes a :class:`AuditEvent` so the chain-of-custody is
traceable from CloudWatch.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from stocvest.api.response import bad_request, forbidden, json_response, not_found, ok
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.proposal_review import (
    PromotionResult,
    promote_proposal,
    proposal_to_detail_dict,
    proposal_to_summary_row,
    reject_proposal,
)
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.models import AuditEvent
from stocvest.data.parameter_proposal_store import (
    PROPOSAL_STATUS_VALUES,
    ParameterProposalStore,
    build_default_proposal_store,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Default page size when ``?status=`` is given without an explicit ``?limit=``.
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 100


# ── Helpers ──────────────────────────────────────────────────────────────


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
    """Return a 403 response when the caller is not authorized; ``None`` when they are."""
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def _resolve_proposal_store(
    proposal_store: ParameterProposalStore | None,
) -> ParameterProposalStore | None:
    """Lazy-build the proposal store; return ``None`` to signal config absence."""
    if proposal_store is not None:
        return proposal_store
    try:
        return build_default_proposal_store()
    except Exception as exc:  # pragma: no cover — config + boto3 path
        _LOG.warning("admin proposals: proposal store unavailable: %s", exc)
        return None


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
    """Best-effort audit emission — admin actions are high-value targets."""
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
                entitlement_snapshot={"admin_action": "proposal_review"},
                pricing_snapshot={},
                request_summary=request_summary,
            )
        )
    except Exception:  # pragma: no cover — audit failures must never block the response
        pass


# ── Handlers ─────────────────────────────────────────────────────────────


def admin_proposals_list_handler(
    event: LambdaEvent,
    context: LambdaContext,
    *,
    proposal_store: ParameterProposalStore | None = None,
) -> dict[str, Any]:
    """``GET /v1/admin/proposals?status=pending&limit=20``."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    qp = _query_params(event)
    status = (qp.get("status") or "pending").strip().lower()
    if status not in PROPOSAL_STATUS_VALUES:
        return bad_request(
            f"status must be one of {sorted(PROPOSAL_STATUS_VALUES)}; got {status!r}"
        )
    try:
        limit = int(qp.get("limit") or _DEFAULT_LIST_LIMIT)
    except ValueError:
        return bad_request("limit must be an integer")
    limit = max(1, min(_MAX_LIST_LIMIT, limit))

    store = _resolve_proposal_store(proposal_store)
    if store is None:
        return json_response(
            503,
            {
                "error": "service_unavailable",
                "message": "Proposal store is not configured.",
            },
        )

    try:
        proposals = store.list_by_status(status, limit=limit)
    except Exception as exc:
        _LOG.exception("admin_proposals_list_handler list_by_status failed: %s", exc)
        return json_response(
            500,
            {"error": "internal_error", "message": "Failed to list proposals."},
        )
    items = [proposal_to_summary_row(p).to_dict() for p in proposals]
    return ok({"status": status, "limit": limit, "items": items})


def admin_proposals_get_handler(
    event: LambdaEvent,
    context: LambdaContext,
    *,
    proposal_store: ParameterProposalStore | None = None,
) -> dict[str, Any]:
    """``GET /v1/admin/proposals/{proposal_id}`` — full detail."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    proposal_id = _path_params(event).get("proposal_id", "").strip()
    if not proposal_id:
        return bad_request("proposal_id path parameter is required.")
    store = _resolve_proposal_store(proposal_store)
    if store is None:
        return json_response(
            503,
            {
                "error": "service_unavailable",
                "message": "Proposal store is not configured.",
            },
        )
    proposal = store.get(proposal_id)
    if proposal is None:
        return not_found(f"Proposal {proposal_id!r} not found.")
    return ok(proposal_to_detail_dict(proposal))


def admin_proposals_promote_handler(
    event: LambdaEvent,
    context: LambdaContext,
    *,
    proposal_store: ParameterProposalStore | None = None,
) -> dict[str, Any]:
    """``POST /v1/admin/proposals/{proposal_id}/promote`` — rotate live weights."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    rc = build_request_context(event)
    proposal_id = _path_params(event).get("proposal_id", "").strip()
    if not proposal_id:
        return bad_request("proposal_id path parameter is required.")
    reviewer = rc.user_id or "unknown"
    store = _resolve_proposal_store(proposal_store)
    if store is None:
        return json_response(
            503,
            {
                "error": "service_unavailable",
                "message": "Proposal store is not configured.",
            },
        )

    result: PromotionResult = promote_proposal(
        proposal_id,
        reviewed_by=reviewer,
        proposal_store=store,
    )

    audit_summary = {
        "action": "promote",
        "proposal_id": proposal_id,
        "success": result.success,
        "new_parameter_version": result.new_parameter_version,
        "superseded_pending_ids": result.superseded_pending_ids,
        "error": result.error,
    }
    _emit_audit(
        event=event,
        route="POST /v1/admin/proposals/{proposal_id}/promote",
        method="POST",
        user_id=rc.user_id,
        status_code=200 if result.success else 409,
        outcome="success" if result.success else "failure",
        request_summary=audit_summary,
    )

    if not result.success:
        # Map common errors to friendly status codes.
        if result.error == "not found":
            return not_found(f"Proposal {proposal_id!r} not found.")
        if result.error and result.error.startswith("not pending:"):
            return json_response(
                409, {"error": "conflict", "message": result.error, **result.to_dict()}
            )
        return json_response(
            500,
            {
                "error": "internal_error",
                "message": result.error or "Promotion failed.",
                **result.to_dict(),
            },
        )
    return ok(result.to_dict())


def admin_proposals_reject_handler(
    event: LambdaEvent,
    context: LambdaContext,
    *,
    proposal_store: ParameterProposalStore | None = None,
) -> dict[str, Any]:
    """``POST /v1/admin/proposals/{proposal_id}/reject`` — record a rejection with note."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny
    rc = build_request_context(event)
    proposal_id = _path_params(event).get("proposal_id", "").strip()
    if not proposal_id:
        return bad_request("proposal_id path parameter is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    review_note = body.get("review_note") if isinstance(body, dict) else None
    if review_note is not None and not isinstance(review_note, str):
        return bad_request("review_note must be a string when provided.")

    store = _resolve_proposal_store(proposal_store)
    if store is None:
        return json_response(
            503,
            {
                "error": "service_unavailable",
                "message": "Proposal store is not configured.",
            },
        )

    reviewer = rc.user_id or "unknown"
    try:
        proposal = reject_proposal(
            proposal_id,
            reviewed_by=reviewer,
            review_note=review_note,
            proposal_store=store,
        )
    except ValueError as exc:
        # Re-raised by mark_rejected when the proposal is not in pending state.
        _emit_audit(
            event=event,
            route="POST /v1/admin/proposals/{proposal_id}/reject",
            method="POST",
            user_id=rc.user_id,
            status_code=409,
            outcome="failure",
            request_summary={"action": "reject", "proposal_id": proposal_id, "error": str(exc)},
        )
        return json_response(409, {"error": "conflict", "message": str(exc)})
    except Exception as exc:
        _LOG.exception("admin_proposals_reject_handler failed: %s", exc)
        return json_response(
            500, {"error": "internal_error", "message": "Rejection failed."}
        )

    _emit_audit(
        event=event,
        route="POST /v1/admin/proposals/{proposal_id}/reject",
        method="POST",
        user_id=rc.user_id,
        status_code=200,
        outcome="success",
        request_summary={
            "action": "reject",
            "proposal_id": proposal_id,
            "review_note": review_note,
        },
    )
    return ok(proposal_to_detail_dict(proposal))
