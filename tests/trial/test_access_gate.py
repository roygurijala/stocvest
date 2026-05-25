"""Trial HTTP access gate."""

from __future__ import annotations

import json

import pytest

from stocvest.trial.access_gate import trial_gate_response


def _event(*, route: str, sub: str = "u1") -> dict:
    method, path = route.split(" ", 1)
    return {
        "routeKey": route,
        "rawPath": path,
        "path": path,
        "httpMethod": method,
        "requestContext": {
            "authorizer": {"claims": {"sub": sub, "email": "u@example.com"}},
            "http": {"method": method, "path": path},
        },
    }


@pytest.fixture(autouse=True)
def _flags_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()


def test_gate_off_allows_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    assert trial_gate_response(_event(route="GET /v1/watchlists"), "GET /v1/watchlists") is None


def test_phone_required_blocks_non_exempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    resp = trial_gate_response(_event(route="GET /v1/watchlists"), "GET /v1/watchlists")
    assert resp is not None
    assert resp["statusCode"] == 403
    body = json.loads(str(resp["body"]))
    assert body["error"] == "phone_verification_required"


def test_users_me_exempt_when_phone_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    assert trial_gate_response(_event(route="GET /v1/users/me"), "GET /v1/users/me") is None
