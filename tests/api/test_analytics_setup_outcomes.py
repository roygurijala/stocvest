"""Tests for GET /v1/analytics/setup-outcomes."""

from __future__ import annotations

import json
from typing import Any

from stocvest.api.handlers.analytics import analytics_setup_outcomes_handler
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.models.watchlist_transition import WatchlistMaturationTransition
from tests.data.test_watchlist_maturation_repository import _FakeDynamoTable


def _event(*, sub: str = "sub-1", mode: str = "swing") -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": "GET /v1/analytics/setup-outcomes",
        "queryStringParameters": {"mode": mode, "days": "30"},
        "requestContext": {
            "requestId": "req-out",
            "authorizer": {"claims": {"sub": sub, "email": "u@example.com"}},
            "http": {"method": "GET", "path": "/v1/analytics/setup-outcomes"},
        },
    }


def test_setup_outcomes_requires_auth() -> None:
    ev = _event()
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = analytics_setup_outcomes_handler(ev, {})
    assert resp["statusCode"] == 401


def test_setup_outcomes_empty_watchlist(monkeypatch) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("sub-1", "Main", [], is_default=True)
    from stocvest.api.handlers import analytics as ah

    ah.get_watchlist_store = lambda: store  # type: ignore[method-assign]
    monkeypatch.setattr(ah, "get_watchlist_maturation_transition_repository", lambda: None)

    resp = analytics_setup_outcomes_handler(_event(), {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["stats"]["total_events"] == 0
    assert body["stats"]["building_dataset"] is True
