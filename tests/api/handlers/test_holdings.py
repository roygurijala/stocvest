from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.holdings import (
    holdings_delete_handler,
    holdings_dispatch_handler,
    holdings_ledger_handler,
    holdings_list_handler,
    holdings_sale_handler,
    holdings_settings_get_handler,
    holdings_settings_put_handler,
    holdings_split_handler,
    holdings_sync_handler,
    holdings_upsert_handler,
)
from stocvest.api.services.holdings_store import (
    get_holdings_store,
    reset_holdings_store_for_tests,
)
from stocvest.api.services.portfolio_advice_ledger import (
    reset_portfolio_advice_ledger_store_for_tests,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _fresh_store() -> None:
    reset_holdings_store_for_tests()
    reset_portfolio_advice_ledger_store_for_tests()
    yield
    reset_holdings_store_for_tests()
    reset_portfolio_advice_ledger_store_for_tests()


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


def test_sale_reduces_lot_credits_cash_and_lands_on_ledger() -> None:
    holdings_upsert_handler(_event("u-sale-1", _holding_payload("WMT")), {})  # 10 @ 182
    holdings_settings_put_handler(_event("u-sale-1", {"cashBalance": 100}), {})
    resp = holdings_sale_handler(
        _event(
            "u-sale-1",
            {"quantity": 4, "salePrice": 200, "soldAt": "2026-09-14", "creditCash": True},
            pathParameters={"symbol": "WMT"},
        ),
        {},
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["holding"]["totalQuantity"] == 6
    assert body["sale"]["kind"] == "sale"
    assert body["sale"]["realizedPl"] == pytest.approx((200 - 182) * 4)
    assert body["sale"]["adviceAttributionStatus"] == "no_review_snapshot"

    cash = json.loads(holdings_settings_get_handler(_event("u-sale-1"), {})["body"])
    assert cash["cashBalance"] == pytest.approx(100 + 800)

    ledger = json.loads(holdings_ledger_handler(_event("u-sale-1"), {})["body"])
    kinds = {e["kind"] for e in ledger["events"]}
    assert "buy" in kinds  # initial upsert
    assert "sale" in kinds
    assert ledger["summary"]["salesCount"] == 1


def test_sale_full_position_removes_holding() -> None:
    holdings_upsert_handler(_event("u-sale-2", _holding_payload("WMT")), {})
    resp = holdings_sale_handler(
        _event(
            "u-sale-2",
            {"quantity": 10, "salePrice": 150, "soldAt": "2026-09-14"},
            pathParameters={"symbol": "WMT"},
        ),
        {},
    )
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["holding"] is None
    listed = json.loads(holdings_list_handler(_event("u-sale-2"), {})["body"])
    assert listed == []


def test_sale_rejects_over_quantity_and_missing_symbol() -> None:
    holdings_upsert_handler(_event("u-sale-3", _holding_payload("WMT")), {})
    over = holdings_sale_handler(
        _event("u-sale-3", {"quantity": 99, "salePrice": 1}, pathParameters={"symbol": "WMT"}),
        {},
    )
    assert over["statusCode"] == 400
    missing = holdings_sale_handler(
        _event("u-sale-3", {"quantity": 1, "salePrice": 1}, pathParameters={"symbol": "ZZZ"}),
        {},
    )
    assert missing["statusCode"] == 404


def test_sale_stamps_last_review_action() -> None:
    holdings_upsert_handler(_event("u-sale-5", _holding_payload("WMT")), {})
    get_holdings_store().put_cached_review(
        "u-sale-5",
        {
            "holdings": [
                {
                    "symbol": "WMT",
                    "action": "sell",
                    "verdict": "bearish",
                    "currentPrice": 160.0,
                    "suggestedReduceAmount": 1820.0,
                    "sizingReason": "Sell overrides target.",
                    "sleeve": "exit",
                    "weightPct": 8.0,
                }
            ]
        },
        "2026-09-14T12:00:00+00:00",
    )
    resp = holdings_sale_handler(
        _event(
            "u-sale-5",
            {"quantity": 10, "salePrice": 155, "soldAt": "2026-09-14"},
            pathParameters={"symbol": "WMT"},
        ),
        {},
    )
    sale = json.loads(resp["body"])["sale"]
    assert sale["adviceAction"] == "sell"
    assert sale["adviceAttributionStatus"] == "stamped"
    assert sale["adviceVerdict"] == "bearish"
    assert sale["priceAtAdvice"] == 160.0


def test_buy_stamps_last_review_before_upsert_wipes_cache() -> None:
    holdings_upsert_handler(_event("u-buy-1", _holding_payload("WMT")), {})
    get_holdings_store().put_cached_review(
        "u-buy-1",
        {
            "holdings": [
                {
                    "symbol": "WMT",
                    "action": "buy_more",
                    "verdict": "bullish",
                    "currentPrice": 190.0,
                    "suggestedAddAmount": 400.0,
                    "sleeve": "standard",
                    "weightPct": 6.0,
                }
            ]
        },
        "2026-09-14T12:00:00+00:00",
    )
    more = {
        "symbol": "WMT",
        "lots": [
            {
                "lotId": "WMT-l1",
                "quantity": 10,
                "costBasis": 182.0,
                "purchaseDate": "2024-06-10",
            },
            {
                "lotId": "WMT-l2",
                "quantity": 2,
                "costBasis": 195.0,
                "purchaseDate": "2026-09-14",
            },
        ],
    }
    resp = holdings_upsert_handler(_event("u-buy-1", more), {})
    assert resp["statusCode"] == 200
    ledger = json.loads(holdings_ledger_handler(_event("u-buy-1"), {})["body"])
    buys = [e for e in ledger["events"] if e["kind"] == "buy"]
    stamped = [e for e in buys if e.get("adviceAction") == "buy_more"]
    assert stamped
    assert stamped[-1]["adviceAttributionStatus"] == "stamped"
    assert stamped[-1]["quantity"] == 2


def test_dispatch_routes_sale_and_ledger() -> None:
    holdings_upsert_handler(_event("u-sale-4", _holding_payload("WMT")), {})
    sale = holdings_dispatch_handler(
        _event(
            "u-sale-4",
            {"quantity": 1, "salePrice": 190, "soldAt": "2026-09-14"},
            routeKey="POST /v1/holdings/WMT/sale",
            pathParameters={"symbol": "WMT"},
        ),
        {},
    )
    assert sale["statusCode"] == 200
    led = holdings_dispatch_handler(_event("u-sale-4", routeKey="GET /v1/holdings/ledger"), {})
    assert led["statusCode"] == 200
    assert json.loads(led["body"])["count"] >= 2
