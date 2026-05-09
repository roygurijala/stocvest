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

def _admin_event(
    method: str,
    *,
    target_user_id: str,
    body: dict[str, Any] | None = None,
    sub: str = "admin-user",
) -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": f"{method} /v1/admin/users/{{user_id}}/beta-access",
        "rawPath": f"/v1/admin/users/{target_user_id}/beta-access",
        "path": f"/v1/admin/users/{target_user_id}/beta-access",
        "pathParameters": {"user_id": target_user_id},
        "httpMethod": method,
        "headers": {"content-type": "application/json", "authorization": "Bearer x"},
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-admin",
            "authorizer": {"claims": {"sub": sub, "scope": "openid email profile"}},
            "http": {"method": method, "path": "/v1/admin/users/{user_id}/beta-access"},
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
    assert b.get("subscription_plan") == "free"
    assert b.get("has_ai_explanations") is False


def test_users_me_patch_ignores_subscription_plan(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from stocvest.data.models import UserProfile

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    fresh_profile_store.put_profile(UserProfile(user_id="user-me-test", subscription_plan="swing_pro"))
    resp = lambda_handler(_event("PATCH", body={"subscription_plan": "free"}), {})
    assert resp["statusCode"] == 200
    b = _body(resp)
    assert b["subscription_plan"] == "swing_pro"
    assert b["has_ai_explanations"] is True
    assert fresh_profile_store.get_profile("user-me-test").subscription_plan == "swing_pro"


def test_users_me_patch_ignores_beta_override_fields(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from stocvest.data.models import UserProfile

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    fresh_profile_store.put_profile(UserProfile(user_id="user-me-test", beta_full_access=False))
    resp = lambda_handler(
        _event(
            "PATCH",
            body={"beta_full_access": True, "beta_access_until": "2099-01-01T00:00:00+00:00"},
        ),
        {},
    )
    assert resp["statusCode"] == 200
    b = _body(resp)
    assert b["beta_full_access"] is False
    assert fresh_profile_store.get_profile("user-me-test").beta_full_access is False


def test_admin_beta_access_requires_authorization(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: False)
    resp = lambda_handler(_admin_event("PATCH", target_user_id="target-1", body={"enabled": True}), {})
    assert resp["statusCode"] == 403


def test_admin_beta_access_grant_indefinite_no_until(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: True)
    grant = lambda_handler(
        _admin_event("PATCH", target_user_id="target-1", body={"enabled": True, "indefinite": True}),
        {},
    )
    assert grant["statusCode"] == 200
    gb = _body(grant)
    assert gb["beta_full_access"] is True
    assert gb.get("beta_access_until") is None
    assert gb["has_full_access"] is True


def test_admin_beta_access_indefinite_rejects_until_combo(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: True)
    resp = lambda_handler(
        _admin_event(
            "PATCH",
            target_user_id="target-1",
            body={"enabled": True, "indefinite": True, "until": "2099-01-01T00:00:00+00:00"},
        ),
        {},
    )
    assert resp["statusCode"] == 400


def test_admin_beta_access_grant_without_until_defaults_21_day_window(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import datetime, timezone

    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: True)
    before = datetime.now(timezone.utc)
    grant = lambda_handler(_admin_event("PATCH", target_user_id="target-1", body={"enabled": True}), {})
    assert grant["statusCode"] == 200
    gb = _body(grant)
    assert gb["beta_full_access"] is True
    assert gb.get("beta_access_until")
    until = datetime.fromisoformat(str(gb["beta_access_until"]).replace("Z", "+00:00"))
    delta_days = (until - before).total_seconds() / 86400.0
    assert 20.9 <= delta_days <= 21.1


def test_admin_beta_access_grant_and_revoke(
    fresh_profile_store: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    import stocvest.api.handlers.orders as orders_mod

    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(orders_mod, "analysis_authorized", lambda **kwargs: True)
    grant = lambda_handler(
        _admin_event(
            "PATCH",
            target_user_id="target-1",
            body={"enabled": True, "until": "2099-01-01T00:00:00+00:00"},
        ),
        {},
    )
    assert grant["statusCode"] == 200
    gb = _body(grant)
    assert gb["beta_full_access"] is True
    assert gb["has_full_access"] is True
    assert gb["has_ai_explanations"] is True
    revoke = lambda_handler(_admin_event("PATCH", target_user_id="target-1", body={"enabled": False}), {})
    assert revoke["statusCode"] == 200
    rb = _body(revoke)
    assert rb["beta_full_access"] is False
    assert rb["has_full_access"] is False


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
