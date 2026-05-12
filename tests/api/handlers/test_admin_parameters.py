"""Lock-in tests for D10 Phase 4 — admin parameter rollback HTTP handlers.

Two routes under ``/v1/admin/parameters``:

* ``GET  /v1/admin/parameters/history`` — list prior versions for the
  rollback picker UI.
* ``POST /v1/admin/parameters/rollback`` — rotate weights backward.

Both gated by the same ``analysis_authorized`` admin gate as the
proposal review surface. The rollback handler is the **second** code
path that mutates the live signal-parameters secret — these tests pin
the HTTP error mapping and the audit-event emission so the chain of
custody for a rollback survives every refactor.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_parameters import (
    admin_parameters_history_handler,
    admin_parameters_rollback_handler,
)
from stocvest.api.services.parameter_rollback import (
    ParameterHistorySummaryRow,
    RollbackResult,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _evt(
    *,
    method: str = "GET",
    path: str = "/v1/admin/parameters/history",
    query_params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    user_id: str = "admin-sub-123",
) -> dict[str, Any]:
    """Build a Lambda event dict for the admin-parameters handlers."""
    return {
        "path": path,
        "pathParameters": None,
        "queryStringParameters": dict(query_params or {}) if query_params else None,
        "requestContext": {
            "requestId": "req-test-1",
            "http": {"method": method, "path": path},
            "authorizer": {"claims": {"sub": user_id}},
        },
        "headers": {"x-stocvest-session-id": "sess-test-1"},
        "body": json.dumps(body) if body is not None else None,
    }


def _history_summary(
    *,
    version: str,
    is_live: bool = False,
    created_at: str = "2026-05-01T00:00:00+00:00",
) -> ParameterHistorySummaryRow:
    return ParameterHistorySummaryRow(
        version=version,
        created_at=created_at,
        reason="manual tuning",
        changed_by="d10-admin:alice",
        signal_count_on_change=100,
        accuracy_before_change=0.62,
        is_current_live_version=is_live,
    )


@pytest.fixture(autouse=True)
def _silence_audit() -> Any:
    """Make audit emission a no-op so handler tests don't touch DDB."""
    with patch("stocvest.api.handlers.admin_parameters.get_audit_store") as m:
        m.return_value.put_event.return_value = None
        yield m


# ─────────────────────────────────────────────────────────────────────────────
# Auth gate — applies to both handlers
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "handler,event",
    [
        (
            admin_parameters_history_handler,
            {"path": "/v1/admin/parameters/history", "queryStringParameters": None},
        ),
        (
            admin_parameters_rollback_handler,
            {
                "path": "/v1/admin/parameters/rollback",
                "body": json.dumps({"target_version": "1.0.3"}),
            },
        ),
    ],
)
def test_handlers_return_403_without_admin_auth(handler: Any, event: dict[str, Any]) -> None:
    """Without admin authorization, both handlers return 403."""
    event.setdefault("requestContext", {"http": {"method": "GET"}, "authorizer": {"claims": {"sub": "anyone"}}})
    event.setdefault("headers", {})
    event.setdefault("pathParameters", None)
    event.setdefault("queryStringParameters", None)
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=False
    ):
        response = handler(event, None)
    assert response["statusCode"] == 403
    body = json.loads(response["body"])
    assert body["error"] == "forbidden"


# ─────────────────────────────────────────────────────────────────────────────
# History handler
# ─────────────────────────────────────────────────────────────────────────────


def test_history_handler_returns_200_with_items():
    rows = [
        _history_summary(version="1.0.5", is_live=True),
        _history_summary(version="1.0.4"),
        _history_summary(version="1.0.3"),
    ]
    event = _evt()
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.list_history_with_live_marker",
        return_value=rows,
    ):
        response = admin_parameters_history_handler(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["limit"] == 50
    assert len(body["items"]) == 3
    assert body["items"][0]["version"] == "1.0.5"
    assert body["items"][0]["is_current_live_version"] is True
    assert body["items"][1]["is_current_live_version"] is False


def test_history_handler_honours_limit_query_param():
    event = _evt(query_params={"limit": "5"})
    captured: dict[str, Any] = {}

    def _capture(*, limit: int, **_kw: Any) -> list[ParameterHistorySummaryRow]:
        captured["limit"] = limit
        return []

    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.list_history_with_live_marker",
        side_effect=_capture,
    ):
        response = admin_parameters_history_handler(event, None)

    assert response["statusCode"] == 200
    assert captured["limit"] == 5


def test_history_handler_clamps_limit_to_max():
    """Defensive: an admin (or a curl in a runbook) asking for 999 rows
    gets clamped to 200, not allowed to drain the table."""
    event = _evt(query_params={"limit": "999"})
    captured: dict[str, Any] = {}

    def _capture(*, limit: int, **_kw: Any) -> list[ParameterHistorySummaryRow]:
        captured["limit"] = limit
        return []

    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.list_history_with_live_marker",
        side_effect=_capture,
    ):
        admin_parameters_history_handler(event, None)

    assert captured["limit"] == 200


def test_history_handler_rejects_non_integer_limit():
    event = _evt(query_params={"limit": "abc"})
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ):
        response = admin_parameters_history_handler(event, None)
    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert "limit" in body["message"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# Rollback handler — success path
# ─────────────────────────────────────────────────────────────────────────────


def test_rollback_handler_success_returns_200_with_result_payload():
    result = RollbackResult(
        success=True,
        target_version="1.0.3",
        rolled_back_from="1.0.5",
        new_parameter_version="1.0.6",
        extras={"target_reason": "prior tuning iter"},
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = admin_parameters_rollback_handler(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["success"] is True
    assert body["target_version"] == "1.0.3"
    assert body["rolled_back_from"] == "1.0.5"
    assert body["new_parameter_version"] == "1.0.6"


def test_rollback_handler_passes_reviewer_user_id():
    """The reviewer's user_id from the JWT claims must flow into
    rollback_to_version so the audit row's changed_by is honest."""
    captured: dict[str, Any] = {}

    def _capture(version: str, *, reviewed_by: str, **kw: Any) -> RollbackResult:
        captured["target_version"] = version
        captured["reviewed_by"] = reviewed_by
        return RollbackResult(
            success=True,
            target_version=version,
            rolled_back_from="1.0.5",
            new_parameter_version="1.0.6",
        )

    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
        user_id="admin-alice-456",
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        side_effect=_capture,
    ):
        response = admin_parameters_rollback_handler(event, None)

    assert response["statusCode"] == 200
    assert captured["target_version"] == "1.0.3"
    assert captured["reviewed_by"] == "admin-alice-456"


# ─────────────────────────────────────────────────────────────────────────────
# Rollback handler — error paths
# ─────────────────────────────────────────────────────────────────────────────


def test_rollback_handler_returns_400_when_body_invalid_json():
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
    )
    event["body"] = "{not valid json"
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 400


def test_rollback_handler_returns_400_when_target_version_missing():
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert "target_version" in body["message"]


def test_rollback_handler_returns_400_when_target_version_empty_string():
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "   "},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 400


def test_rollback_handler_returns_400_when_target_version_not_string():
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": 42},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 400


def test_rollback_handler_maps_not_found_to_404():
    result = RollbackResult(
        success=False, target_version="1.0.99", error="not found"
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.99"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 404


def test_rollback_handler_maps_already_on_target_to_409():
    result = RollbackResult(
        success=False,
        target_version="1.0.5",
        rolled_back_from="1.0.5",
        error="already on target version",
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.5"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 409
    body = json.loads(response["body"])
    assert body["error"] == "conflict"
    assert body["target_version"] == "1.0.5"


def test_rollback_handler_maps_save_failed_to_500():
    result = RollbackResult(
        success=False,
        target_version="1.0.3",
        rolled_back_from="1.0.5",
        error="parameter save failed",
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 500
    body = json.loads(response["body"])
    assert body["error"] == "internal_error"


def test_rollback_handler_maps_invalid_history_row_to_500():
    result = RollbackResult(
        success=False,
        target_version="1.0.3",
        rolled_back_from="1.0.5",
        error="invalid history row",
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = admin_parameters_rollback_handler(event, None)
    assert response["statusCode"] == 500


# ─────────────────────────────────────────────────────────────────────────────
# Audit emission
# ─────────────────────────────────────────────────────────────────────────────


def test_rollback_handler_emits_audit_event_on_success(_silence_audit):
    result = RollbackResult(
        success=True,
        target_version="1.0.3",
        rolled_back_from="1.0.5",
        new_parameter_version="1.0.6",
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        admin_parameters_rollback_handler(event, None)

    audit_calls = _silence_audit.return_value.put_event.call_args_list
    assert len(audit_calls) == 1
    audit_event = audit_calls[0].args[0]
    # AuditEvent's outcome field is "success" on the happy path.
    assert audit_event.outcome == "success"
    assert audit_event.status_code == 200
    assert audit_event.request_summary["action"] == "rollback"
    assert audit_event.request_summary["target_version"] == "1.0.3"
    assert audit_event.request_summary["new_parameter_version"] == "1.0.6"


def test_rollback_handler_emits_audit_event_on_conflict(_silence_audit):
    result = RollbackResult(
        success=False,
        target_version="1.0.5",
        rolled_back_from="1.0.5",
        error="already on target version",
    )
    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.5"},
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        admin_parameters_rollback_handler(event, None)

    audit_calls = _silence_audit.return_value.put_event.call_args_list
    assert len(audit_calls) == 1
    audit_event = audit_calls[0].args[0]
    assert audit_event.outcome == "failure"
    assert audit_event.status_code == 409


# ─────────────────────────────────────────────────────────────────────────────
# Dispatch wiring (signals_http_dispatch)
# ─────────────────────────────────────────────────────────────────────────────


def test_signals_http_dispatch_routes_get_history_to_handler():
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _evt(path="/v1/admin/parameters/history")
    event["requestContext"]["http"]["path"] = "/v1/admin/parameters/history"
    event["routeKey"] = "GET /v1/admin/parameters/history"

    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.list_history_with_live_marker",
        return_value=[],
    ):
        response = signals_http_dispatch(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == []


def test_signals_http_dispatch_routes_post_rollback_to_handler():
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _evt(
        method="POST",
        path="/v1/admin/parameters/rollback",
        body={"target_version": "1.0.3"},
    )
    event["requestContext"]["http"]["path"] = "/v1/admin/parameters/rollback"
    event["routeKey"] = "POST /v1/admin/parameters/rollback"

    result = RollbackResult(
        success=True,
        target_version="1.0.3",
        rolled_back_from="1.0.5",
        new_parameter_version="1.0.6",
    )
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_parameters.rollback_to_version",
        return_value=result,
    ):
        response = signals_http_dispatch(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["success"] is True
    assert body["new_parameter_version"] == "1.0.6"
