"""Lock-in tests for ``GET /v1/admin/audit/recent`` (global audit feed)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_audit import admin_audit_recent_handler
from stocvest.data.models import AuditEvent


def _evt(*, query_params: dict[str, str] | None = None, sub: str = "admin-1") -> dict[str, Any]:
    return {
        "path": "/v1/admin/audit/recent",
        "pathParameters": None,
        "queryStringParameters": dict(query_params) if query_params else None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": "GET", "path": "/v1/admin/audit/recent"},
            "authorizer": {"claims": {"sub": sub}},
        },
        "headers": {},
    }


def _audit_event(*, ts: str = "2026-05-01T00:00:00+00:00", module: str = "signals") -> AuditEvent:
    return AuditEvent(
        event_id=f"ev-{ts}",
        occurred_at=datetime.fromisoformat(ts),
        module=module,
        route="GET /v1/x",
        method="GET",
        path="/v1/x",
        status_code=200,
        outcome="success",
    )


def test_returns_403_without_admin() -> None:
    event = _evt()
    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=False
    ):
        response = admin_audit_recent_handler(event, None)
    assert response["statusCode"] == 403


def test_returns_recent_events() -> None:
    event = _evt()
    rows = [
        _audit_event(ts="2026-05-03T00:00:00+00:00"),
        _audit_event(ts="2026-05-02T00:00:00+00:00"),
    ]
    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=True
    ), patch("stocvest.api.handlers.admin_audit.get_audit_store") as m:
        m.return_value.list_recent_events.return_value = rows
        response = admin_audit_recent_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["limit"] == 100
    assert body["module"] is None
    assert len(body["items"]) == 2


def test_forwards_module_filter() -> None:
    event = _evt(query_params={"module": "brokers", "limit": "10"})
    captured: dict[str, Any] = {}

    def _capture(**kwargs: Any) -> list[AuditEvent]:
        captured.update(kwargs)
        return []

    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=True
    ), patch("stocvest.api.handlers.admin_audit.get_audit_store") as m:
        m.return_value.list_recent_events.side_effect = _capture
        response = admin_audit_recent_handler(event, None)
    assert response["statusCode"] == 200
    assert captured["module"] == "brokers"
    assert captured["limit"] == 10


def test_forwards_route_prefix_filter() -> None:
    event = _evt(query_params={"route_prefix": "GET /v1/admin"})
    captured: dict[str, Any] = {}

    def _capture(**kwargs: Any) -> list[AuditEvent]:
        captured.update(kwargs)
        return []

    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=True
    ), patch("stocvest.api.handlers.admin_audit.get_audit_store") as m:
        m.return_value.list_recent_events.side_effect = _capture
        admin_audit_recent_handler(event, None)
    assert captured["route_prefix"] == "GET /v1/admin"


def test_clamps_limit_at_500() -> None:
    event = _evt(query_params={"limit": "9999"})
    captured: dict[str, Any] = {}

    def _capture(**kwargs: Any) -> list[AuditEvent]:
        captured.update(kwargs)
        return []

    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=True
    ), patch("stocvest.api.handlers.admin_audit.get_audit_store") as m:
        m.return_value.list_recent_events.side_effect = _capture
        admin_audit_recent_handler(event, None)
    assert captured["limit"] == 500


def test_rejects_non_integer_limit() -> None:
    event = _evt(query_params={"limit": "abc"})
    with patch(
        "stocvest.api.handlers.admin_audit.analysis_authorized", return_value=True
    ):
        response = admin_audit_recent_handler(event, None)
    assert response["statusCode"] == 400
