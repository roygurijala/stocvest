from __future__ import annotations

import pytest
import respx
from httpx import Response

from stocvest.brokers.etrade_http_gateway import ETradeHttpGateway
from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRateLimitError,
    BrokerRejectedError,
)


@pytest.mark.unit
def test_gateway_requires_token() -> None:
    gw = ETradeHttpGateway()
    gw.connect(consumer_key="k", consumer_secret="s", sandbox=True)
    with pytest.raises(BrokerAuthError, match="OAuth token"):
        gw.list_accounts()


@pytest.mark.unit
@respx.mock
def test_gateway_list_accounts_parses_response() -> None:
    gw = ETradeHttpGateway()
    gw.connect(consumer_key="k", consumer_secret="s", sandbox=True)
    gw.set_oauth_token("tok")
    respx.get("https://apisb.etrade.com/v1/accounts/list.json").mock(
        return_value=Response(
            200,
            json={
                "AccountListResponse": {
                    "Accounts": {
                        "Account": [
                            {"accountIdKey": "A1", "accountDesc": "Sandbox 1"},
                        ]
                    }
                }
            },
        )
    )
    rows = gw.list_accounts()
    assert rows[0]["account_id"] == "A1"


@pytest.mark.unit
@respx.mock
def test_gateway_place_and_cancel_order_updates_cache() -> None:
    gw = ETradeHttpGateway()
    gw.connect(consumer_key="k", consumer_secret="s", sandbox=True)
    gw.set_oauth_token("tok")
    respx.post("https://apisb.etrade.com/v1/accounts/A1/orders/place.json").mock(
        return_value=Response(200, json={"PlaceOrderResponse": {"orderId": "12345"}})
    )
    respx.post("https://apisb.etrade.com/v1/accounts/A1/orders/cancel.json").mock(
        return_value=Response(200, json={"CancelOrderResponse": {"orderId": "12345"}})
    )
    ack = gw.place_order(
        "A1",
        {
            "client_order_id": "c1",
            "symbol": "MSFT",
            "side": "buy",
            "quantity": 2.0,
            "order_type": "limit",
            "time_in_force": "day",
            "limit_price": 250.0,
            "stop_price": None,
        },
    )
    assert ack["broker_order_id"] == "12345"
    row = gw.get_order("A1", "c1")
    assert row is not None and row["status"] == "submitted"
    gw.cancel_order("A1", "c1")
    row2 = gw.get_order("A1", "c1")
    assert row2 is not None and row2["status"] == "cancelled"


@pytest.mark.unit
@respx.mock
def test_gateway_error_mapping() -> None:
    gw = ETradeHttpGateway()
    gw.connect(consumer_key="k", consumer_secret="s", sandbox=True)
    gw.set_oauth_token("tok")

    respx.get("https://apisb.etrade.com/v1/accounts/list.json").mock(return_value=Response(429))
    with pytest.raises(BrokerRateLimitError):
        gw.list_accounts()

    respx.get("https://apisb.etrade.com/v1/accounts/A2/portfolio.json").mock(return_value=Response(404))
    with pytest.raises(BrokerNotFoundError):
        gw.get_positions("A2")

    respx.post("https://apisb.etrade.com/v1/accounts/A1/orders/place.json").mock(
        return_value=Response(400, text="bad request")
    )
    with pytest.raises(BrokerRejectedError):
        gw.place_order(
            "A1",
            {
                "client_order_id": "cx",
                "symbol": "MSFT",
                "side": "buy",
                "quantity": 1.0,
                "order_type": "market",
                "time_in_force": "day",
                "limit_price": None,
                "stop_price": None,
            },
        )

