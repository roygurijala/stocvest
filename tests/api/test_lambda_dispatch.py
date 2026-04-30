from __future__ import annotations

import json
import os

import pytest

from stocvest.api.lambda_dispatch import lambda_handler


@pytest.fixture(autouse=True)
def _clear_lambda_module_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STOCVEST_LAMBDA_MODULE", raising=False)


def test_lambda_handler_requires_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STOCVEST_LAMBDA_MODULE", raising=False)
    r = lambda_handler({"version": "2.0", "routeKey": "GET /v1/health"}, {})
    assert r["statusCode"] == 404


def test_health_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "health")
    r = lambda_handler({"version": "2.0", "routeKey": "GET /v1/health"}, {})
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["status"] == "ok"


def test_market_data_unknown_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "market_data")
    r = lambda_handler({"version": "2.0", "routeKey": "POST /v1/market/status"}, {})
    assert r["statusCode"] == 404


def test_scanner_schedule_through_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "scanner")

    def _fake(st: str) -> dict:
        return {"invocation": "schedule", "scan_type": st, "status": "completed", "setup_key": "k"}

    monkeypatch.setattr("stocvest.api.handlers.scanner.run_scheduled_scan_sync", _fake)
    r = lambda_handler({"source": "eventbridge", "scan_type": "intraday"}, {})
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["invocation"] == "schedule"


def test_websocket_connect_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "websocket")
    event = {
        "requestContext": {
            "routeKey": "$connect",
            "connectionId": "cid-lambda-dispatch",
            "authorizer": {"claims": {"sub": "u1"}},
        }
    }
    r = lambda_handler(event, {})
    assert r["statusCode"] == 200


def test_unknown_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "not_a_module")
    r = lambda_handler({}, {})
    assert r["statusCode"] == 404


def test_dispatch_uses_stocvest_lambda_module_from_os() -> None:
    os.environ["STOCVEST_LAMBDA_MODULE"] = "health"
    try:
        r = lambda_handler({"version": "2.0", "routeKey": "GET /v1/health"}, {})
        assert r["statusCode"] == 200
    finally:
        del os.environ["STOCVEST_LAMBDA_MODULE"]
