"""Tests for laggard API endpoints (Chunk 8)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.handlers import laggard as lag_handlers
from stocvest.api.handlers.laggard import scanner_laggards_handler, signal_laggard_handler
from stocvest.api.services import laggard_api as la
from stocvest.data.models import UserProfile


def _auth_event(
    route: str,
    *,
    sub: str = "user-paid",
    symbol: str | None = None,
    qs: dict[str, str] | None = None,
) -> dict[str, Any]:
    pp = {"symbol": symbol} if symbol else None
    return {
        "version": "2.0",
        "routeKey": route,
        "pathParameters": pp,
        "queryStringParameters": qs or {},
        "requestContext": {
            "requestId": "req-lag",
            "authorizer": {"claims": {"sub": sub, "email": "u@example.com"}},
            "http": {"method": "GET", "path": route.split(" ", 1)[-1]},
        },
    }


def _paid_profile() -> UserProfile:
    return UserProfile(user_id="user-paid", email="u@example.com", subscription_plan="swing_pro")


def _free_profile() -> UserProfile:
    return UserProfile(user_id="user-free", email="f@example.com", subscription_plan="free")


@pytest.fixture
def _profiles(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Store:
        def get_profile(self, user_id: str) -> UserProfile | None:
            if user_id == "user-paid":
                return _paid_profile()
            if user_id == "user-free":
                return _free_profile()
            return None

    monkeypatch.setattr(la, "get_user_profile_store", lambda: _Store())


def test_laggard_endpoint_requires_auth_401() -> None:
    ev = _auth_event("GET /v1/signals/AVGO/laggard", sub="")
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = signal_laggard_handler(ev, {})
    assert resp["statusCode"] == 401


def test_laggard_endpoint_free_plan_403(_profiles: None) -> None:
    resp = signal_laggard_handler(_auth_event("GET /v1/signals/AVGO/laggard", sub="user-free"), {})
    assert resp["statusCode"] == 403


def test_laggard_swing_pro_200(_profiles: None, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "symbol": "AVGO",
        "has_laggard_signal": True,
        "laggard_type": "catch_up",
        "driver_type": "sector",
        "confidence": "high",
        "laggard_score": 78.5,
        "narrative": {"summary_line": "AVGO lags peers"},
    }
    monkeypatch.setattr(lag_handlers, "get_symbol_laggard_payload_sync", lambda *a, **k: payload)
    resp = signal_laggard_handler(_auth_event("GET /v1/signals/AVGO/laggard", sub="user-paid"), {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["has_laggard_signal"] is True
    assert body["symbol"] == "AVGO"


def test_laggard_returns_has_signal_false_gracefully(_profiles: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        lag_handlers,
        "get_symbol_laggard_payload_sync",
        lambda *a, **k: {"symbol": "NVDA", "has_laggard_signal": False, "reason": "leading"},
    )
    resp = signal_laggard_handler(_auth_event("GET /v1/signals/NVDA/laggard", sub="user-paid"), {})
    body = json.loads(resp["body"])
    assert body["has_laggard_signal"] is False


def test_laggard_day_mode_null_response(_profiles: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        lag_handlers,
        "get_symbol_laggard_payload_sync",
        lambda *a, **k: {
            "symbol": "AVGO",
            "has_laggard_signal": False,
            "reason": "swing only",
        },
    )
    resp = signal_laggard_handler(
        _auth_event("GET /v1/signals/AVGO/laggard", sub="user-paid", qs={"mode": "day"}),
        {},
    )
    body = json.loads(resp["body"])
    assert body["has_laggard_signal"] is False


def test_scanner_laggards_requires_auth_401() -> None:
    ev = _auth_event("GET /v1/scanner/laggards", sub="")
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = scanner_laggards_handler(ev, {})
    assert resp["statusCode"] == 401


def test_scanner_laggards_free_plan_403(_profiles: None) -> None:
    resp = scanner_laggards_handler(_auth_event("GET /v1/scanner/laggards", sub="user-free"), {})
    assert resp["statusCode"] == 403


def test_scanner_empty_no_data_200_not_error(_profiles: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        lag_handlers,
        "scan_laggards_sync",
        lambda **k: {"session_date": "2026-05-18", "scanned": 10, "laggards_found": 0, "laggards": []},
    )
    resp = scanner_laggards_handler(_auth_event("GET /v1/scanner/laggards", sub="user-paid"), {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["laggards_found"] == 0
    assert body["laggards"] == []


def test_scanner_confidence_filter_high_only(_profiles: None) -> None:
    rows = [
        {"symbol": "A", "confidence": "high", "laggard_score": 80.0, "laggard_type": "catch_up", "driver_type": "sector"},
        {"symbol": "B", "confidence": "medium", "laggard_score": 70.0, "laggard_type": "catch_up", "driver_type": "sector"},
    ]

    async def _fake_scan(**kwargs: Any) -> dict[str, Any]:
        conf = kwargs.get("confidence", "all")
        filtered = [r for r in rows if la._confidence_matches(str(r["confidence"]), conf)]
        return {"session_date": "2026-05-18", "scanned": 2, "laggards_found": len(filtered), "laggards": filtered}

    import asyncio

    orig = la.scan_laggards

    async def _wrap(**kwargs: Any) -> dict[str, Any]:
        return await _fake_scan(**kwargs)

    la.scan_laggards = _wrap  # type: ignore[method-assign]
    try:
        body = asyncio.run(la.scan_laggards(user_id="user-paid", confidence="high"))
        assert len(body["laggards"]) == 1
        assert body["laggards"][0]["symbol"] == "A"
    finally:
        la.scan_laggards = orig  # type: ignore[method-assign]


def test_scanner_driver_filter_sector_only() -> None:
    assert la._driver_matches("sector", "sector") is True
    assert la._driver_matches("theme", "sector") is False
    assert la._driver_matches("pre_ipo_proxy", "pre_ipo") is True


def test_scanner_type_filter_catch_up_only() -> None:
    assert la._type_matches("catch_up", "catch_up") is True
    assert la._type_matches("distribution", "catch_up") is False
