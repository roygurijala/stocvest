"""Lock-in tests for ``GET /v1/admin/parameters/current``.

The current-parameters view is read-only and goes through the same
admin gate as the rollback surface. Tests pin:

* 403 without admin auth.
* Successful payload serializes ``SignalParameters`` via
  ``signal_parameters_to_dict`` (no leaked SecretsManager metadata).
* A backend failure collapses to 500 rather than raising.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_parameters import admin_parameters_current_handler
from stocvest.config.signal_parameters import default_signal_parameters


def _evt(*, sub: str = "admin-1") -> dict[str, Any]:
    return {
        "path": "/v1/admin/parameters/current",
        "pathParameters": None,
        "queryStringParameters": None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": "GET", "path": "/v1/admin/parameters/current"},
            "authorizer": {"claims": {"sub": sub}},
        },
        "headers": {},
    }


def test_returns_403_without_admin() -> None:
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized",
        return_value=False,
    ):
        response = admin_parameters_current_handler(_evt(), None)
    assert response["statusCode"] == 403


def test_returns_current_parameters_as_dict() -> None:
    params = default_signal_parameters()
    params.version = "1.0.5"
    params.created_at = "2026-05-01T00:00:00+00:00"
    params.notes = "manual tuning"
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_parameters.ParameterStore.get_parameters_sync",
        return_value=params,
    ):
        response = admin_parameters_current_handler(_evt(), None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["version"] == "1.0.5"
    assert body["created_at"] == "2026-05-01T00:00:00+00:00"
    assert body["notes"] == "manual tuning"
    assert isinstance(body["parameters"], dict)
    assert "composite" in body["parameters"]


def test_returns_500_when_parameter_store_fails() -> None:
    with patch(
        "stocvest.api.handlers.admin_parameters.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_parameters.ParameterStore.get_parameters_sync",
        side_effect=RuntimeError("secrets manager unreachable"),
    ):
        response = admin_parameters_current_handler(_evt(), None)
    assert response["statusCode"] == 500
