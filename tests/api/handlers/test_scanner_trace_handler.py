"""GET /v1/signals/scanner-trace handler."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers import signals as signals_handlers


def _event(qs: str = "") -> dict:
    route = "GET /v1/signals/scanner-trace"
    if qs:
        route = f"{route}?{qs}"
    return {
        "rawPath": "/v1/signals/scanner-trace",
        "requestContext": {
            "http": {"method": "GET", "path": "/v1/signals/scanner-trace"},
            "routeKey": route,
        },
        "queryStringParameters": dict(x.split("=") for x in qs.split("&") if x) if qs else None,
        "headers": {},
    }


def test_scanner_trace_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        signals_handlers,
        "build_request_context",
        lambda _e: type("RC", (), {"user_id": None})(),
    )
    resp = signals_handlers.scanner_trace_handler(_event(), None)
    assert resp["statusCode"] == 401


def test_scanner_trace_returns_persisted_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        signals_handlers,
        "build_request_context",
        lambda _e: type("RC", (), {"user_id": "u-test"})(),
    )
    monkeypatch.setattr(
        signals_handlers,
        "get_scanner_evaluation_traces_merged",
        lambda _uid, **kwargs: [
            {
                "symbol": "AMD",
                "desk": "day",
                "gate": "score_floor",
                "detail": "Best setup score 0.42 is below the 0.55 minimum",
                "outcome": "did_not_qualify",
            }
        ],
    )
    monkeypatch.setattr(signals_handlers, "session_date_et", lambda: "2026-05-16")
    resp = signals_handlers.scanner_trace_handler(_event("mode=day"), None)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["evaluation_trace"][0]["symbol"] == "AMD"
    assert "not a watchlist" in body["disclaimer"]
