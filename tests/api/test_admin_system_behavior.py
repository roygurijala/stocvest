"""Tests for GET /v1/admin/system-behavior."""

from __future__ import annotations

import json
from typing import Any

from stocvest.api.handlers.analytics import admin_system_behavior_handler


def _event(*, sub: str = "admin-sub") -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": "GET /v1/admin/system-behavior",
        "queryStringParameters": {"mode": "swing"},
        "requestContext": {
            "requestId": "req-sysbeh",
            "authorizer": {
                "claims": {
                    "sub": sub,
                    "email": "admin@example.com",
                    "cognito:groups": "signal-analytics-admin",
                }
            },
            "http": {"method": "GET", "path": "/v1/admin/system-behavior"},
        },
        "headers": {},
    }


def test_admin_system_behavior_requires_auth() -> None:
    ev = _event()
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = admin_system_behavior_handler(ev, {})
    assert resp["statusCode"] == 401


def test_admin_system_behavior_denies_non_admin(monkeypatch) -> None:
    from stocvest.api.handlers import analytics as ah

    monkeypatch.setattr(ah, "analysis_authorized", lambda **_: False)
    resp = admin_system_behavior_handler(_event(sub="user-1"), {})
    assert resp["statusCode"] == 401


def test_admin_system_behavior_ok_for_admin(monkeypatch) -> None:
    from stocvest.api.handlers import analytics as ah
    from stocvest.data.watchlist_maturation_transition_repository import (
        WatchlistMaturationTransitionRepository,
    )
    from tests.data.test_watchlist_maturation_repository import _FakeDynamoTable

    trans_table = _FakeDynamoTable()
    trans_repo = WatchlistMaturationTransitionRepository(trans_table)
    monkeypatch.setattr(ah, "analysis_authorized", lambda **_: True)
    monkeypatch.setattr(ah, "get_watchlist_maturation_transition_repository", lambda: trans_repo)

    resp = admin_system_behavior_handler(_event(), {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["mode"] == "swing"
    assert body["scope"] == "platform"
    assert body["transition_count"] == 0
    assert body["unique_users"] == 0
