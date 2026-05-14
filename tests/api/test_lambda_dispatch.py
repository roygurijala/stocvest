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

    def _fake(st: str, **kwargs: object) -> dict:
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


def test_geo_themes_job_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "geo_themes")

    def fake(_event: dict, _ctx: dict) -> dict:
        return {"statusCode": 200, "themes_count": 2}

    monkeypatch.setattr("stocvest.workers.geo_themes_updater.handler", fake)
    r = lambda_handler({"action": "update_geo_themes"}, {})
    assert r["statusCode"] == 200
    assert r["themes_count"] == 2


def test_orb_compute_job_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "orb_compute")

    def fake(_event: dict, _ctx: dict) -> dict:
        return {"statusCode": 200, "computed": 1, "symbols": ["AAPL"]}

    monkeypatch.setattr("stocvest.workers.orb_compute_worker.handler", fake)
    r = lambda_handler({"action": "compute_orb"}, {})
    assert r["statusCode"] == 200
    assert r["computed"] == 1


def test_macro_warmer_job_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "macro_warmer")

    def fake(_event: dict, _ctx: dict) -> dict:
        return {"statusCode": 200, "events": 3, "yield_curve": True}

    monkeypatch.setattr("stocvest.workers.macro_cache_warmer.handler", fake)
    r = lambda_handler({"source": "eventbridge"}, {})
    assert r["statusCode"] == 200
    assert r["events"] == 3


def test_dispatch_uses_stocvest_lambda_module_from_os() -> None:
    os.environ["STOCVEST_LAMBDA_MODULE"] = "health"
    try:
        r = lambda_handler({"version": "2.0", "routeKey": "GET /v1/health"}, {})
        assert r["statusCode"] == 200
    finally:
        del os.environ["STOCVEST_LAMBDA_MODULE"]


def test_signals_gap_intel_cache_tick_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "signals")

    def fake_tick(event: dict, ctx: dict) -> dict:  # noqa: ANN001
        _ = ctx
        assert event.get("gap_intel_cache_tick") is True
        return {"statusCode": 200, "body": json.dumps({"warmed": []})}

    monkeypatch.setattr(
        "stocvest.workers.gap_intel_cache_tick.gap_intel_cache_tick_handler", fake_tick
    )
    r = lambda_handler({"gap_intel_cache_tick": True}, {})
    assert r["statusCode"] == 200
