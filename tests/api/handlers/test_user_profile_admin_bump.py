"""Lock-in tests for the admin-claim entitlement bump in
:func:`stocvest.api.handlers.orders._serialize_user_profile` and
:func:`stocvest.api.handlers.signals.ai_explanations_handler`.

The bump is the bridge between "admin Cognito group" and "complete app
access" — without it an admin could be in the admin group but still
hit paid feature gates while inspecting the app. These tests pin:

* ``_serialize_user_profile`` OR-bumps ``has_full_access`` /
  ``has_ai_explanations`` when ``is_admin=True``.
* The persisted ``UserProfile`` row is NOT mutated by the bump (no
  privilege confusion via the admin viewing themselves).
* ``users_me_get_handler`` threads ``analysis_authorized`` through to
  the serializer so the JWT group claim drives the bump end-to-end.
* ``admin_beta_access_patch_handler`` keeps ``is_admin=False`` when
  returning the target user's profile — the bump only applies to the
  caller's own ``/me`` response.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.orders import (
    _serialize_user_profile,
    admin_beta_access_patch_handler,
    users_me_get_handler,
)
from stocvest.api.services.user_profile_store import (
    InMemoryUserProfileStore,
    reset_user_profile_store_for_tests,
)
from stocvest.data.models import TradingMode, UserProfile


@pytest.fixture(autouse=True)
def _reset_store() -> None:
    reset_user_profile_store_for_tests()
    yield
    reset_user_profile_store_for_tests()


@pytest.fixture
def _patch_audit_store(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make audit emission a no-op (handler tests don't touch DDB)."""
    import stocvest.api.handlers.orders as orders_mod

    class _Noop:
        def put_event(self, event: Any) -> None:
            pass

    monkeypatch.setattr(orders_mod, "get_audit_store", lambda: _Noop())


def _free_profile() -> UserProfile:
    return UserProfile(
        user_id="sub-1",
        email="alice@x.com",
        subscription_plan="free",
        beta_full_access=False,
        trading_mode=TradingMode.PAPER,
    )


def _evt_users_me(*, sub: str = "sub-1") -> dict[str, Any]:
    return {
        "path": "/v1/users/me",
        "pathParameters": None,
        "queryStringParameters": None,
        "headers": {},
        "requestContext": {
            "requestId": "req-1",
            "http": {"method": "GET", "path": "/v1/users/me"},
            "authorizer": {"claims": {"sub": sub}},
        },
    }


# ── _serialize_user_profile ─────────────────────────────────────────────


def test_serialize_default_is_admin_false_preserves_gates() -> None:
    payload = _serialize_user_profile(_free_profile())
    assert payload["is_admin"] is False
    assert payload["has_full_access"] is False
    assert payload["has_ai_explanations"] is False


def test_serialize_with_is_admin_true_bumps_entitlements() -> None:
    profile = _free_profile()
    payload = _serialize_user_profile(profile, is_admin=True)
    assert payload["is_admin"] is True
    assert payload["has_full_access"] is True
    assert payload["has_ai_explanations"] is True
    # Persistence is NOT mutated: the model itself still reports the
    # paid-gate values as if the user were free. (The bump is purely
    # response-shaping; the row is untouched.)
    assert profile.has_full_access is False


def test_serialize_paid_user_admin_is_idempotent() -> None:
    profile = UserProfile(user_id="sub-1", subscription_plan="swing_pro")
    payload = _serialize_user_profile(profile, is_admin=True)
    assert payload["has_full_access"] is True
    assert payload["has_ai_explanations"] is True
    assert payload["is_admin"] is True


# ── users_me_get_handler end-to-end ─────────────────────────────────────


def test_users_me_get_bumps_when_caller_is_admin(_patch_audit_store: None) -> None:
    """The handler must compute is_admin from analysis_authorized."""
    store = InMemoryUserProfileStore()
    store.put_profile(_free_profile())

    with patch(
        "stocvest.api.handlers.orders.get_user_profile_store", return_value=store
    ), patch(
        "stocvest.api.handlers.orders.analysis_authorized", return_value=True
    ):
        response = users_me_get_handler(_evt_users_me(), None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["is_admin"] is True
    assert body["has_full_access"] is True
    assert body["has_ai_explanations"] is True


def test_users_me_get_does_not_bump_when_caller_is_not_admin(_patch_audit_store: None) -> None:
    store = InMemoryUserProfileStore()
    store.put_profile(_free_profile())

    with patch(
        "stocvest.api.handlers.orders.get_user_profile_store", return_value=store
    ), patch(
        "stocvest.api.handlers.orders.analysis_authorized", return_value=False
    ):
        response = users_me_get_handler(_evt_users_me(), None)
    body = json.loads(response["body"])
    assert body["is_admin"] is False
    assert body["has_full_access"] is False


# ── admin_beta_access_patch_handler must NOT bump the target profile ─────


def test_admin_beta_access_patch_does_not_bump_target_user_to_admin(
    _patch_audit_store: None,
) -> None:
    """Privilege confusion guard: an admin toggling beta access for a
    target user must not return the target's profile with the admin
    flags set — that would suggest the target is also admin."""
    store = InMemoryUserProfileStore()
    target_profile = UserProfile(user_id="target-1", subscription_plan="free")
    store.put_profile(target_profile)

    event = {
        "path": "/v1/admin/users/target-1/beta-access",
        "pathParameters": {"user_id": "target-1"},
        "queryStringParameters": None,
        "headers": {},
        "requestContext": {
            "requestId": "req-1",
            "http": {"method": "PATCH", "path": "/v1/admin/users/target-1/beta-access"},
            "authorizer": {"claims": {"sub": "admin-1"}},
        },
        "body": json.dumps({"enabled": True, "indefinite": True}),
    }

    with patch(
        "stocvest.api.handlers.orders.get_user_profile_store", return_value=store
    ), patch(
        "stocvest.api.handlers.orders.analysis_authorized", return_value=True
    ):
        response = admin_beta_access_patch_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    # Target is NOT marked admin even though the caller is.
    assert body["is_admin"] is False
    # Beta toggle still applied.
    assert body["beta_full_access"] is True
    assert body["has_full_access"] is True  # via beta, not admin
