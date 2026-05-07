from __future__ import annotations

import json

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.api.services.audit_store import reset_audit_store_for_tests
from stocvest.api.services.user_profile_store import InMemoryUserProfileStore


def _event_users_me_get(*, sub: str = "audit-user", session_id: str = "sess-1") -> dict:
    return {
        "version": "2.0",
        "routeKey": "GET /v1/users/me",
        "rawPath": "/v1/users/me",
        "path": "/v1/users/me",
        "httpMethod": "GET",
        "headers": {"content-type": "application/json", "authorization": "Bearer x", "x-stocvest-session-id": session_id},
        "body": None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-audit-1",
            "authorizer": {"claims": {"sub": sub, "scope": "openid email profile"}},
            "http": {"method": "GET", "path": "/v1/users/me"},
        },
    }


def _event_admin_user_audit(*, target_user_id: str, sub: str = "admin-user") -> dict:
    return {
        "version": "2.0",
        "routeKey": "GET /v1/admin/audit/users/{user_id}",
        "rawPath": f"/v1/admin/audit/users/{target_user_id}",
        "path": f"/v1/admin/audit/users/{target_user_id}",
        "pathParameters": {"user_id": target_user_id},
        "httpMethod": "GET",
        "headers": {"content-type": "application/json", "authorization": "Bearer x"},
        "body": None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-audit-admin",
            "authorizer": {"claims": {"sub": sub, "scope": "openid email profile"}},
            "http": {"method": "GET", "path": "/v1/admin/audit/users/{user_id}"},
        },
    }


@pytest.fixture(autouse=True)
def _reset_audit() -> None:
    reset_audit_store_for_tests()
    yield
    reset_audit_store_for_tests()


@pytest.fixture
def _patch_profile_store(monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setattr(orders_mod, "get_user_profile_store", lambda: InMemoryUserProfileStore())


def test_http_action_is_captured_and_retrievable(_patch_profile_store: None, monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: True)
    r1 = lambda_handler(_event_users_me_get(sub="u-audit", session_id="sess-audit"), {})
    assert r1["statusCode"] == 200
    r2 = lambda_handler(_event_admin_user_audit(target_user_id="u-audit"), {})
    assert r2["statusCode"] == 200
    rows = json.loads(r2["body"])
    assert isinstance(rows, list)
    assert len(rows) >= 1
    first = rows[0]
    assert first["user_id"] == "u-audit"
    assert first["session_id"] == "sess-audit"
    assert first["route"] == "GET /v1/users/me"
