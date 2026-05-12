"""Lock-in tests for ``GET /v1/admin/system-status``.

The admin hub's "Operations overview" tile composes data from five
sources. Each best-effort path is pinned here so a missing backend in
dev (no DDB, no Cognito) collapses to a safe default instead of crashing
the whole tile.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_system_status import admin_system_status_handler
from stocvest.api.services.parameter_rollback import ParameterHistorySummaryRow
from stocvest.data.models import AuditEvent
from stocvest.data.parameter_history_store import ParameterHistoryRow


def _evt(*, sub: str = "admin-1") -> dict[str, Any]:
    return {
        "path": "/v1/admin/system-status",
        "pathParameters": None,
        "queryStringParameters": None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": "GET", "path": "/v1/admin/system-status"},
            "authorizer": {"claims": {"sub": sub}},
        },
        "headers": {},
    }


class _Params:
    version = "1.0.5"
    created_at = "2026-05-01T00:00:00+00:00"
    notes = "manual tuning"


def _history_row() -> ParameterHistoryRow:
    return ParameterHistoryRow(
        version="1.0.5",
        created_at="2026-05-01T00:00:00+00:00",
        reason="manual tuning",
        parameters_json="{}",
        signal_count_on_change=10,
        accuracy_before_change=0.62,
        changed_by="d10-admin:alice",
    )


def _audit_event() -> AuditEvent:
    return AuditEvent(
        event_id="ev-1",
        occurred_at=datetime.fromisoformat("2026-05-01T00:00:00+00:00"),
        module="signals",
        route="GET /v1/signals/recent",
        method="GET",
        path="/v1/signals/recent",
        status_code=200,
        outcome="success",
    )


def test_returns_403_without_admin() -> None:
    with patch(
        "stocvest.api.handlers.admin_system_status.analysis_authorized",
        return_value=False,
    ):
        response = admin_system_status_handler(_evt(), None)
    assert response["statusCode"] == 403


def test_returns_aggregated_status_with_all_fields() -> None:
    with patch(
        "stocvest.api.handlers.admin_system_status.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_system_status.ParameterStore.get_parameters_sync",
        return_value=_Params(),
    ), patch(
        "stocvest.api.handlers.admin_system_status.list_parameter_history_versions",
        return_value=[_history_row()],
    ), patch(
        "stocvest.api.handlers.admin_system_status.get_audit_store"
    ) as m_audit, patch(
        "stocvest.api.handlers.admin_system_status._pending_proposal_count",
        return_value=3,
    ), patch(
        "stocvest.api.handlers.admin_system_status._admin_user_count",
        return_value=2,
    ), patch(
        "stocvest.api.handlers.admin_system_status.get_founding_member_count",
        return_value=14,
    ):
        m_audit.return_value.list_recent_events.return_value = [_audit_event()]
        response = admin_system_status_handler(_evt(), None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["current_parameter"]["version"] == "1.0.5"
    assert body["pending_proposal_count"] == 3
    assert body["admin_user_count"] == 2
    assert body["founding_member_count"] == 14
    assert body["latest_history"]["version"] == "1.0.5"
    assert body["latest_history"]["is_current_live_version"] is True
    assert len(body["recent_audit_events"]) == 1


def test_returns_safe_defaults_when_backends_unavailable() -> None:
    """In dev / pytest without DDB or Cognito each path collapses to a
    safe default rather than 500-ing the whole tile."""
    class _BadParamStore:
        @classmethod
        def get_parameters_sync(cls) -> Any:
            raise RuntimeError("secrets manager unreachable")

    with patch(
        "stocvest.api.handlers.admin_system_status.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_system_status.ParameterStore",
        _BadParamStore,
    ), patch(
        "stocvest.api.handlers.admin_system_status.list_parameter_history_versions",
        side_effect=Exception("ddb down"),
    ), patch(
        "stocvest.api.handlers.admin_system_status.get_audit_store"
    ) as m_audit, patch(
        "stocvest.api.handlers.admin_system_status._pending_proposal_count",
        return_value=0,
    ), patch(
        "stocvest.api.handlers.admin_system_status._admin_user_count",
        return_value=0,
    ), patch(
        "stocvest.api.handlers.admin_system_status.get_founding_member_count",
        return_value=0,
    ):
        m_audit.return_value.list_recent_events.side_effect = Exception("ddb down")
        response = admin_system_status_handler(_evt(), None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["current_parameter"]["version"] == ""
    assert body["latest_history"] is None
    assert body["recent_audit_events"] == []
    assert body["pending_proposal_count"] == 0
