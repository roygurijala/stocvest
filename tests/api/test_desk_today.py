"""GET /v1/desk/today — Opportunity Desk cache read."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.desk import desk_today_handler


def _event(mode: str = "swing") -> dict:
    return {
        "httpMethod": "GET",
        "path": "/v1/desk/today",
        "queryStringParameters": {"mode": mode},
        "requestContext": {"http": {"method": "GET", "path": "/v1/desk/today"}},
    }


def test_desk_today_cache_miss() -> None:
    out = desk_today_handler(_event("swing"), {})
    assert out["statusCode"] == 200
    body = json.loads(out["body"])
    assert body["source"] == "cache_miss"
    assert body["data"] is None
    assert body["mode"] == "swing"
    assert "disclaimer" in body


def test_desk_today_cache_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    envelope = {
        "state_version": "swing_2026_05_26",
        "computed_at": "2026-05-26T12:00:00Z",
        "market_date": "2026-05-26",
        "ttl_seconds": 300,
        "data": {
            "discovery": [{"symbol": "MU", "gap_percent": 16.0}],
            "movers_radar": [{"symbol": "MU", "gap_percent": 16.0}],
            "eligible_symbol_count": 42,
        },
    }

    monkeypatch.setattr(
        "stocvest.api.handlers.desk.read_dashboard_cache",
        lambda _key: envelope,
    )
    out = desk_today_handler(_event("swing"), {})
    body = json.loads(out["body"])
    assert body["source"] == "cache"
    assert body["data"]["eligible_symbol_count"] == 42
    assert body["envelope"]["state_version"] == "swing_2026_05_26"


def test_desk_today_invalid_mode() -> None:
    ev = _event("invalid")
    out = desk_today_handler(ev, {})
    assert out["statusCode"] == 400
