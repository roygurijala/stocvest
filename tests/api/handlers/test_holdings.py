from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.holdings import (
    holdings_delete_handler,
    holdings_dispatch_handler,
    holdings_list_handler,
    holdings_settings_get_handler,
    holdings_settings_put_handler,
    holdings_split_handler,
    holdings_sync_handler,
    holdings_upsert_handler,
)
from stocvest.api.services.holdings_store import reset_holdings_store_for_tests

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _fresh_store() -> None:
    reset_holdings_store_for_tests()
    yield
    reset_holdings_store_for_tests()


def _event(user_sub: str, body: dict[str, object] | None = None, **extra: object) -> dict[str, object]:
    event: dict[str, object] = {
        "requestContext": {"authorizer": {"claims": {"sub": user_sub}}},
        "body": json.dumps(body) if body is not None else None,
    }
    event.update(extra)
    return event


def _holding_payload(symbol: str = "AAPL") -> dict[str, object]:
    return {
        "symbol": symbol,
        "lots": [
            {
                "lotId": f"{symbol}-l1",
                "quantity": 10,
                "costBasis": 182.0,
                "purchaseDate": "2024-06-10",
            }
        ],
    }


def test_upsert_list_and_delete() -> None:
    upsert = holdings_upsert_handler(_event("u-h-1", _holding_payload()), {})
    assert upsert["statusCode"] == 200
    body = json.loads(upsert["body"])
    assert body["symbol"] == "AAPL"
    assert body["averageCost"] == 182.0

    listed = holdings_list_handler(_event("u-h-1"), {})
    assert len(json.loads(listed["body"])) == 1

    deleted = holdings_delete_handler(
        _event("u-h-1", pathParameters={"symbol": "AAPL"}),
        {},
    )
    assert deleted["statusCode"] == 200
    assert json.loads(holdings_list_handler(_event("u-h-1"), {})["body"]) == []


def test_sync_replaces_whole_portfolio() -> None:
    holdings_upsert_handler(_event("u-h-2", _holding_payload("AAPL")), {})
    sync = holdings_sync_handler(
        _event("u-h-2", {"holdings": [_holding_payload("MSFT"), _holding_payload("TSLA")]}),
        {},
    )
    assert sync["statusCode"] == 200
    symbols = {h["symbol"] for h in json.loads(sync["body"])}
    assert symbols == {"MSFT", "TSLA"}  # AAPL replaced away


def test_requires_authenticated_user() -> None:
    assert holdings_list_handler({"requestContext": {}, "body": None}, {})["statusCode"] == 401
    assert holdings_upsert_handler({"requestContext": {}, "body": None}, {})["statusCode"] == 401


def test_rejects_user_id_in_body() -> None:
    payload = _holding_payload()
    payload["userId"] = "someone-else"
    resp = holdings_upsert_handler(_event("u-h-3", payload), {})
    assert resp["statusCode"] == 400


def test_rejects_invalid_holding() -> None:
    resp = holdings_upsert_handler(_event("u-h-4", {"symbol": "AAPL", "lots": []}), {})
    assert resp["statusCode"] == 400


def test_dispatch_routes_by_route_key() -> None:
    event = _event(
        "u-h-5",
        _holding_payload(),
        requestContext={
            "authorizer": {"claims": {"sub": "u-h-5"}},
            "http": {"method": "PUT", "path": "/v1/holdings"},
        },
        routeKey="PUT /v1/holdings",
    )
    resp = holdings_dispatch_handler(event, {})
    assert resp["statusCode"] == 200


def test_settings_default_get_then_put_roundtrip() -> None:
    got = holdings_settings_get_handler(_event("u-h-6"), {})
    assert got["statusCode"] == 200
    assert json.loads(got["body"]) == {
        "cashBalance": 0.0,
        "targetPositionPct": None,
        "benchmarkSymbol": "SPY",
    }

    put = holdings_settings_put_handler(
        _event("u-h-6", {"cashBalance": 7500, "targetPositionPct": 6.5, "benchmarkSymbol": "qqq"}),
        {},
    )
    assert put["statusCode"] == 200
    body = json.loads(put["body"])
    assert body["cashBalance"] == 7500.0
    assert body["targetPositionPct"] == 6.5
    assert body["benchmarkSymbol"] == "QQQ"

    again = holdings_settings_get_handler(_event("u-h-6"), {})
    assert json.loads(again["body"])["cashBalance"] == 7500.0


def test_settings_preserved_across_holdings_writes() -> None:
    holdings_settings_put_handler(_event("u-h-7", {"cashBalance": 1000}), {})
    holdings_upsert_handler(_event("u-h-7", _holding_payload("AAPL")), {})
    got = holdings_settings_get_handler(_event("u-h-7"), {})
    assert json.loads(got["body"])["cashBalance"] == 1000.0


def test_settings_rejects_bad_target_pct() -> None:
    resp = holdings_settings_put_handler(_event("u-h-8", {"targetPositionPct": 150}), {})
    assert resp["statusCode"] == 400


def test_settings_rejects_user_id_in_body() -> None:
    resp = holdings_settings_put_handler(_event("u-h-9", {"cashBalance": 1, "userId": "x"}), {})
    assert resp["statusCode"] == 400


def test_settings_requires_auth() -> None:
    assert holdings_settings_get_handler({"requestContext": {}, "body": None}, {})["statusCode"] == 401
    assert holdings_settings_put_handler({"requestContext": {}, "body": None}, {})["statusCode"] == 401


def test_split_forward_adjusts_lots() -> None:
    holdings_upsert_handler(_event("u-h-11", _holding_payload("AAPL")), {})  # 10 @ 182
    resp = holdings_split_handler(
        _event("u-h-11", {"ratio": 2}, pathParameters={"symbol": "AAPL"}),
        {},
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalQuantity"] == 20
    assert body["averageCost"] == 91.0
    assert body["totalCost"] == 1820.0  # unchanged
    assert body["lots"][0]["purchaseDate"] == "2024-06-10"  # holding period preserved


def test_split_reverse_via_numerator_denominator() -> None:
    holdings_upsert_handler(_event("u-h-12", _holding_payload("AAPL")), {})  # 10 @ 182
    resp = holdings_split_handler(
        _event("u-h-12", {"numerator": 1, "denominator": 10}, pathParameters={"symbol": "AAPL"}),
        {},
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalQuantity"] == 1
    assert body["averageCost"] == 1820.0


def test_split_unknown_symbol_404() -> None:
    resp = holdings_split_handler(
        _event("u-h-13", {"ratio": 2}, pathParameters={"symbol": "NOPE"}),
        {},
    )
    assert resp["statusCode"] == 404


def test_split_rejects_bad_ratio_and_user_id() -> None:
    holdings_upsert_handler(_event("u-h-14", _holding_payload("AAPL")), {})
    assert (
        holdings_split_handler(
            _event("u-h-14", {"ratio": 0}, pathParameters={"symbol": "AAPL"}), {}
        )["statusCode"]
        == 400
    )
    assert (
        holdings_split_handler(
            _event("u-h-14", {"ratio": 2, "userId": "x"}, pathParameters={"symbol": "AAPL"}), {}
        )["statusCode"]
        == 400
    )


def test_split_requires_auth() -> None:
    assert holdings_split_handler({"requestContext": {}, "body": None}, {})["statusCode"] == 401


def test_dispatch_routes_split() -> None:
    holdings_upsert_handler(_event("u-h-15", _holding_payload("AAPL")), {})
    event = _event(
        "u-h-15",
        {"ratio": 4},
        pathParameters={"symbol": "AAPL"},
        routeKey="POST /v1/holdings/{symbol}/split",
    )
    resp = holdings_dispatch_handler(event, {})
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["totalQuantity"] == 40


def test_dispatch_routes_settings() -> None:
    put_event = _event(
        "u-h-10",
        {"cashBalance": 4200},
        routeKey="PUT /v1/holdings/settings",
    )
    put = holdings_dispatch_handler(put_event, {})
    assert put["statusCode"] == 200

    get_event = _event("u-h-10", routeKey="GET /v1/holdings/settings")
    got = holdings_dispatch_handler(get_event, {})
    assert got["statusCode"] == 200
    assert json.loads(got["body"])["cashBalance"] == 4200.0
