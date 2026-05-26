"""Phone OTP API — secure trial onboarding."""

from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.api.services.user_profile_store import InMemoryUserProfileStore
from stocvest.trial.otp_store import InMemoryOtpStore, reset_otp_store_for_tests
from stocvest.trial.phone_ledger_store import InMemoryPhoneLedgerStore, reset_phone_ledger_store_for_tests


def _event(method: str, path_suffix: str, *, body: dict[str, Any] | None = None, sub: str = "trial-user") -> dict[str, Any]:
    path = f"/v1/users/me/phone/{path_suffix}"
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "path": path,
        "httpMethod": method,
        "headers": {"content-type": "application/json", "authorization": "Bearer x"},
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-trial",
            "authorizer": {"claims": {"sub": sub, "scope": "openid email profile"}},
            "http": {"method": method, "path": path},
        },
    }


def _body(resp: dict[str, Any]) -> dict[str, Any]:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def trial_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    monkeypatch.setenv("PHONE_VERIFICATION_REQUIRED", "true")
    monkeypatch.setenv("TRIAL_PHONE_HMAC_PEPPER", "test-pepper")
    monkeypatch.setenv("TRIAL_SMS_ENABLED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    reset_otp_store_for_tests()
    reset_phone_ledger_store_for_tests()


@pytest.fixture
def fresh_stores(monkeypatch: pytest.MonkeyPatch) -> InMemoryUserProfileStore:
    import stocvest.api.handlers.orders as orders_mod
    import stocvest.api.handlers.trial_phone as trial_mod
    import stocvest.trial.phone_service as phone_svc

    profile_store = InMemoryUserProfileStore()
    otp_store = InMemoryOtpStore()
    ledger_store = InMemoryPhoneLedgerStore()
    monkeypatch.setattr(orders_mod, "get_user_profile_store", lambda: profile_store)
    monkeypatch.setattr(trial_mod, "get_user_profile_store", lambda: profile_store)
    monkeypatch.setattr(phone_svc, "get_otp_store", lambda: otp_store)
    monkeypatch.setattr(phone_svc, "get_phone_ledger_store", lambda: ledger_store)
    return profile_store


def test_phone_endpoints_disabled_without_flags(
    fresh_stores: InMemoryUserProfileStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "false")
    monkeypatch.setenv("PHONE_VERIFICATION_REQUIRED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    resp = lambda_handler(
        _event("POST", "request-code", body={"phone_e164": "+15551234567", "sms_opt_in": True}),
        {},
    )
    assert resp["statusCode"] == 403


def test_request_and_verify_starts_trial(
    trial_env: None,
    fresh_stores: InMemoryUserProfileStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import stocvest.trial.phone_service as svc

    captured: list[str] = []

    def _fake_sms(*, phone_e164: str, code: str) -> None:
        captured.append(code)

    monkeypatch.setattr(svc, "send_trial_otp_sms", _fake_sms)

    req = lambda_handler(
        _event("POST", "request-code", body={"phone_e164": "+15551234567", "sms_opt_in": True}),
        {},
    )
    assert req["statusCode"] == 200
    assert len(captured) == 1
    code = captured[0]

    verify = lambda_handler(_event("POST", "verify-code", body={"code": code}), {})
    assert verify["statusCode"] == 200
    body = _body(verify)
    assert body["phone_verified"] is True
    assert body["access_state"] == "trial_active"
    assert body["has_full_access"] is True
    assert body.get("trial_ends_at")

    profile = fresh_stores.get_profile("trial-user")
    assert profile.phone_verified is True
    assert profile.phone_hmac
    assert profile.phone_last4 == "4567"


def test_second_account_cannot_reuse_phone(
    trial_env: None,
    fresh_stores: InMemoryUserProfileStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import stocvest.trial.phone_service as svc

    codes: dict[str, str] = {}

    def _fake_sms(*, phone_e164: str, code: str) -> None:
        codes[phone_e164] = code

    monkeypatch.setattr(svc, "send_trial_otp_sms", _fake_sms)

    lambda_handler(
        _event("POST", "request-code", body={"phone_e164": "+15551234567", "sms_opt_in": True}, sub="user-a"),
        {},
    )
    lambda_handler(
        _event("POST", "verify-code", body={"code": codes["+15551234567"]}, sub="user-a"),
        {},
    )

    reuse = lambda_handler(
        _event("POST", "request-code", body={"phone_e164": "+15551234567", "sms_opt_in": True}, sub="user-b"),
        {},
    )
    assert reuse["statusCode"] == 409
