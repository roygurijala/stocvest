"""Aggregated admin "system status" read.

Single route: ``GET /v1/admin/system-status``.

The admin hub renders this as a tile on the landing page so the operator
can see at a glance:

* Current ``SignalParameters`` version + when it was rotated last.
* How many proposals are waiting for review.
* The newest ``ParameterHistory`` row (which weight rotation is live).
* Newest five audit events so admin actions stay visible.
* Total admin count and founding-member usage.

All reads are best-effort: when a backing store is unconfigured the
corresponding field collapses to a safe default (``None`` / ``0`` / ``[]``)
rather than failing the whole response. That way the admin hub still
loads in dev environments where DDB / Cognito are stubbed.

This handler is deliberately a single composition over already-exposed
read APIs — no new DDB queries beyond what other admin pages already
make. Adding the tile here means there's exactly one place to keep
"what does the admin care about at a glance" up to date.
"""

from __future__ import annotations

from typing import Any

from stocvest.api.response import forbidden, ok
from stocvest.api.services.admin_user_directory import ADMIN_COGNITO_GROUP
from stocvest.api.services.audit_store import get_audit_store
from stocvest.api.services.parameter_rollback import history_row_to_summary
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.services.user_profile_store import get_founding_member_count
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.config.parameter_store import ParameterStore
from stocvest.data.parameter_history_store import list_parameter_history_versions
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_RECENT_AUDIT_SAMPLE = 5


def _require_admin(event: LambdaEvent) -> dict[str, Any] | None:
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def _pending_proposal_count() -> int:
    """Cheap GSI-backed count of pending proposals (capped at 100).

    Returns ``0`` when the proposal table is unconfigured (e.g. tests
    or dev without DDB) — the admin hub shows "0 pending" gracefully
    rather than erroring out the whole tile.
    """
    settings = get_settings()
    if not (settings.dynamodb_parameter_proposal_table or "").strip():
        return 0
    try:
        from stocvest.data.parameter_proposal_store import build_default_proposal_store

        store = build_default_proposal_store()
        return len(store.list_by_status("pending", limit=100))
    except Exception as exc:
        _LOG.debug("pending proposal count failed: %s", exc)
        return 0


def _admin_user_count() -> int:
    """Count members of the admin Cognito group (best-effort)."""
    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    if not pool:
        return 0
    region = (settings.cognito_region or settings.aws_region or "us-east-1").strip()
    try:
        import boto3

        client = boto3.client("cognito-idp", region_name=region)
        resp = client.list_users_in_group(
            UserPoolId=pool, GroupName=ADMIN_COGNITO_GROUP, Limit=60
        )
        users = resp.get("Users") or []
        return len(users)
    except Exception as exc:
        _LOG.debug("admin user count failed: %s", exc)
        return 0


def admin_system_status_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/system-status`` — aggregate operations snapshot."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    try:
        params = ParameterStore.get_parameters_sync()
        current_version = params.version
        current_created_at = params.created_at
        current_notes = params.notes
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.debug("ParameterStore.get_parameters_sync failed: %s", exc)
        current_version = ""
        current_created_at = ""
        current_notes = ""

    try:
        history = list_parameter_history_versions(limit=1)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.debug("list_parameter_history_versions failed: %s", exc)
        history = []
    latest_history = (
        history_row_to_summary(history[0], current_live_version=current_version).to_dict()
        if history
        else None
    )

    try:
        recent_audit = get_audit_store().list_recent_events(limit=_RECENT_AUDIT_SAMPLE)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.debug("list_recent_events failed: %s", exc)
        recent_audit = []

    pending_proposals = _pending_proposal_count()
    admin_users = _admin_user_count()
    founding_members = get_founding_member_count()

    return ok(
        {
            "current_parameter": {
                "version": current_version,
                "created_at": current_created_at,
                "notes": current_notes,
            },
            "latest_history": latest_history,
            "pending_proposal_count": pending_proposals,
            "admin_user_count": admin_users,
            "founding_member_count": founding_members,
            "recent_audit_events": [e.model_dump(mode="json") for e in recent_audit],
        }
    )
