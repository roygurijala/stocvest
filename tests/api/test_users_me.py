"""GET/PATCH /v1/users/me — profile + legal ack + onboarding."""

from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.api.services.user_profile_store import InMemoryUserProfileStore


def _event(method: str, *, body: dict[str, Any] | None = None, sub: str = "user-me-test") -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": f"{method} /v1/users/me",
        "rawPath": "/v1/users/me",
        "path": "/v1/users/me",
        "httpMethod": method,
        "headers": {"content-type": "application/json", "authorization": "Bearer x"},
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-1",
            "authorizer": {"claims": {"sub": sub, "scope": "openid email profile"}},
            "http": {"method": method, "path": "/v1/users/me"},
        },
    }


def _body(resp: dict[str, Any]) -> dict[str, Any]:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def fresh_profile_store(monkeypatch: pytest.MonkeyPatch) -> InMemoryUserProfileStore:
    import stocvest.api.handlers.orders as orders_mod

    store = InMemoryUserProfileStore()
    monkeypatch.setattr(orders_mod, "get_user_profile_store", lambda: store)
    return store


def test_users_me_get_returns_defaults(fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    resp = lambda_handler(_event("GET"), {})
    assert resp["statusCode"] == 200
    b = _body(resp)
    assert b["user_id"] == "user-me-test"
    assert b["legal_acknowledged"] is False
    assert b["onboarding_completed"] is False


def test_users_me_patch_legal_ack(fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    resp = lambda_handler(
        _event(
            "PATCH",
            body={
                "legal_acknowledged": True,
                "legal_acknowledged_version": "1.0",
                "legal_acknowledged_at": "2026-05-03T12:00:00+00:00",
            },
        ),
        {},
    )
    assert resp["statusCode"] == 200
    b = _body(resp)
    assert b["legal_acknowledged"] is True
    assert b["legal_acknowledged_version"] == "1.0"
    p = fresh_profile_store.get_profile("user-me-test")
    assert p.legal_acknowledged is True


def test_users_me_patch_requires_version_when_ack_true(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    resp = lambda_handler(_event("PATCH", body={"legal_acknowledged": True}), {})
    assert resp["statusCode"] == 400


def test_users_me_patch_onboarding(fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    lambda_handler(
        _event(
            "PATCH",
            body={
                "legal_acknowledged": True,
                "legal_acknowledged_version": "1.0",
            },
        ),
        {},
    )
    r2 = lambda_handler(_event("PATCH", body={"onboarding_completed": True}), {})
    assert r2["statusCode"] == 200
    assert _body(r2)["onboarding_completed"] is True
