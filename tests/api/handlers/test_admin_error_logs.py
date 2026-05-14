"""Lock-in tests for ``GET /v1/admin/error-logs`` (CloudWatch Logs Insights)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from stocvest.api.handlers.admin_error_logs import admin_error_logs_recent_handler
from stocvest.api.lambda_dispatch import lambda_handler


def _evt(*, query_params: dict[str, str] | None = None, sub: str = "admin-1") -> dict[str, Any]:
    return {
        "path": "/v1/admin/error-logs",
        "pathParameters": None,
        "queryStringParameters": dict(query_params) if query_params else None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": "GET", "path": "/v1/admin/error-logs"},
            "authorizer": {"claims": {"sub": sub}},
        },
        "headers": {},
    }


def test_returns_403_without_admin() -> None:
    with patch(
        "stocvest.api.handlers.admin_error_logs.analysis_authorized", return_value=False
    ):
        response = admin_error_logs_recent_handler(_evt(), None)
    assert response["statusCode"] == 403


def test_returns_items_when_insights_succeeds() -> None:
    fake_logs = MagicMock()
    fake_logs.describe_log_groups.return_value = {
        "logGroups": [{"logGroupName": "/aws/lambda/stocvest-development-api-signals"}],
        "nextToken": None,
    }
    fake_logs.start_query.return_value = {"queryId": "q-test-1"}
    fake_logs.get_query_results.return_value = {
        "status": "Complete",
        "statistics": {"recordsMatched": 1.0},
        "results": [
            [
                {"field": "@timestamp", "value": "2026-05-01 12:00:00.000"},
                {"field": "@logGroup", "value": "/aws/lambda/stocvest-development-api-signals"},
                {"field": "@message", "value": "[ERROR]\ttest\tboom"},
            ]
        ],
    }
    fake_settings = SimpleNamespace(env="development", aws_region="us-east-1", cloudwatch_admin_error_log_group_prefix="")

    with patch(
        "stocvest.api.handlers.admin_error_logs.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_error_logs.get_settings", return_value=fake_settings
    ), patch("stocvest.api.handlers.admin_error_logs.boto3.client", return_value=fake_logs):
        response = admin_error_logs_recent_handler(_evt(), None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["days"] == 7
    assert body["query_error"] is None
    assert len(body["log_groups"]) == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["message"] == "[ERROR]\ttest\tboom"
    fake_logs.start_query.assert_called_once()


def test_empty_log_groups_returns_ok_with_no_items() -> None:
    fake_logs = MagicMock()
    fake_logs.describe_log_groups.return_value = {"logGroups": [], "nextToken": None}
    fake_settings = SimpleNamespace(env="development", aws_region="us-east-1", cloudwatch_admin_error_log_group_prefix="/nope/")

    with patch(
        "stocvest.api.handlers.admin_error_logs.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_error_logs.get_settings", return_value=fake_settings
    ), patch("stocvest.api.handlers.admin_error_logs.boto3.client", return_value=fake_logs):
        response = admin_error_logs_recent_handler(_evt(), None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == []
    assert body["log_groups"] == []
    fake_logs.start_query.assert_not_called()


def test_lambda_dispatch_brokers_routes_error_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    fake_logs = MagicMock()
    fake_logs.describe_log_groups.return_value = {"logGroups": [], "nextToken": None}
    fake_settings = SimpleNamespace(env="development", aws_region="us-east-1", cloudwatch_admin_error_log_group_prefix="/x/")
    event = {
        "version": "2.0",
        "routeKey": "GET /v1/admin/error-logs",
        "rawPath": "/v1/admin/error-logs",
        "requestContext": {
            "requestId": "req-1",
            "authorizer": {"claims": {"sub": "admin-1"}},
            "http": {"method": "GET", "path": "/v1/admin/error-logs"},
        },
        "headers": {},
    }
    with patch(
        "stocvest.api.handlers.admin_error_logs.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_error_logs.get_settings", return_value=fake_settings
    ), patch("stocvest.api.handlers.admin_error_logs.boto3.client", return_value=fake_logs):
        resp = lambda_handler(event, {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert "items" in body
