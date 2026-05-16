from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.data.watchlist_store import InMemoryWatchlistStore


def _ev(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    path_parameters: dict[str, str] | None = None,
    sub: str = "wl-track-1",
) -> dict[str, Any]:
    rk = f"{method} {path}"
    return {
        "version": "2.0",
        "routeKey": rk,
        "path": path,
        "httpMethod": method,
        "pathParameters": path_parameters,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-wl-track",
            "authorizer": {"claims": {"sub": sub, "email": "t@example.com"}},
            "http": {"method": method, "path": path},
        },
    }


def _body(resp: dict[str, Any]) -> Any:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def brokers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")


def test_patch_symbol_tracking_persists_modes(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    w = store.create_watchlist("wl-track-1", "Main", ["TSLA"], is_default=True)
    resp = lambda_handler(
        _ev(
            "PATCH",
            f"/v1/watchlists/{w.watchlist_id}/symbols/TSLA/tracking",
            body={"track_swing": True, "track_day": False},
            path_parameters={"watchlist_id": w.watchlist_id, "symbol": "TSLA"},
        ),
        {},
    )
    assert resp["statusCode"] == 200
    data = _body(resp)
    assert data["symbol_tracking"]["TSLA"] == {"swing": True, "day": False}


def test_default_symbols_get_includes_tracking(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    w = store.create_watchlist("wl-track-1", "Main", ["AAPL"], is_default=True)
    store.set_symbol_tracking("wl-track-1", w.watchlist_id, "AAPL", track_swing=True, track_day=True)
    resp = lambda_handler(_ev("GET", "/v1/watchlists/default/symbols"), {})
    assert resp["statusCode"] == 200
    data = _body(resp)
    assert data["symbols"] == ["AAPL"]
    assert data["symbol_tracking"]["AAPL"]["swing"] is True


def test_patch_tracking_rejects_both_disabled(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    w = store.create_watchlist("wl-track-1", "Main", ["MSFT"], is_default=True)
    resp = lambda_handler(
        _ev(
            "PATCH",
            f"/v1/watchlists/{w.watchlist_id}/symbols/MSFT/tracking",
            body={"track_swing": False, "track_day": False},
            path_parameters={"watchlist_id": w.watchlist_id, "symbol": "MSFT"},
        ),
        {},
    )
    assert resp["statusCode"] == 400
