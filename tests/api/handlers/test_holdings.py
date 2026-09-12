from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.holdings import (
    holdings_delete_handler,
    holdings_dispatch_handler,
    holdings_list_handler,
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
