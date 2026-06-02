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


def _event_with_symbol(mode: str = "swing", symbol: str = "NVDA") -> dict:
    ev = _event(mode)
    ev["queryStringParameters"] = {"mode": mode, "why_symbol": symbol}
    return ev


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


def test_desk_today_returns_symbol_diagnostic_on_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_diag(symbol: str) -> dict:
        return {
            "symbol": symbol,
            "stage": "eligibility_gate",
            "reason_code": "price_below_5",
            "reason": "Trade price below $5 minimum.",
        }

    monkeypatch.setattr("stocvest.api.handlers.desk._desk_symbol_diagnostic_async", _fake_diag)
    out = desk_today_handler(_event_with_symbol("swing", "nvda"), {})
    assert out["statusCode"] == 200
    body = json.loads(out["body"])
    assert body["why_missing"]["symbol"] == "NVDA"
    assert body["why_missing"]["reason_code"] == "price_below_5"
