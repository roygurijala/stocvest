from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from stocvest.api.handlers.brokers import (
    broker_accounts_handler,
    broker_cancel_order_handler,
    broker_get_order_handler,
    broker_health_handler,
    broker_place_order_handler,
    broker_positions_handler,
)
from stocvest.brokers.exceptions import BrokerNotFoundError
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderSide,
    OrderStatus,
    PlaceOrderRequest,
)


@dataclass
class _FakeAdapter:
    last_connect_config: dict[str, Any] | None = None

    async def connect(self, config: dict[str, Any]) -> None:
        self.last_connect_config = config

    async def disconnect(self) -> None:
        return None

    async def health_check(self) -> BrokerHealth:
        return BrokerHealth(ok=True, message="ok")

    async def list_accounts(self) -> list[BrokerAccount]:
        return [BrokerAccount(account_id="A1", display_name="Paper")]

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        if account_id != "A1":
            raise BrokerNotFoundError("Unknown account")
        return [BrokerPosition(symbol="AAPL", quantity=3.0, avg_cost=150.0)]

    async def place_order(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        if account_id != "A1":
            raise BrokerNotFoundError("Unknown account")
        return OrderAck(client_order_id=request.client_order_id, broker_order_id="B-1")

    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        if account_id != "A1":
            raise BrokerNotFoundError("Unknown account")
        return OrderStatus(
            client_order_id=client_order_id,
            broker_order_id="B-1",
            status=OrderLifecycleStatus.SUBMITTED,
            symbol="AAPL",
            side=OrderSide.BUY,
            quantity_ordered=1.0,
        )

    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        if account_id != "A1":
            raise BrokerNotFoundError("Unknown account")
        _ = client_order_id


class _FakeFactory:
    @staticmethod
    def create(kind: str) -> _FakeAdapter:
        assert kind in {"mock", "ibkr", "etrade"}
        return _FakeAdapter()


class _FakeGatewayProvider:
    @staticmethod
    def build_connect_config(broker_kind: str) -> dict[str, Any]:
        _ = broker_kind
        return {}


def test_broker_health_handler() -> None:
    event = {"queryStringParameters": {"broker": "mock"}}
    response = broker_health_handler(
        event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["broker"] == "mock"
    assert body["ok"] is True


def test_broker_accounts_handler() -> None:
    event = {"queryStringParameters": {"broker": "mock"}}
    response = broker_accounts_handler(
        event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body[0]["account_id"] == "A1"


def test_broker_positions_handler_requires_account() -> None:
    event = {"queryStringParameters": {"broker": "mock"}}
    response = broker_positions_handler(
        event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert response["statusCode"] == 400


def test_broker_place_get_cancel_order_handlers() -> None:
    place_event = {
        "queryStringParameters": {"broker": "mock", "account_id": "A1"},
        "body": json.dumps(
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "client_order_id": "order-1",
            }
        ),
    }
    place_resp = broker_place_order_handler(
        place_event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert place_resp["statusCode"] == 200
    assert json.loads(place_resp["body"])["client_order_id"] == "order-1"

    get_event = {
        "queryStringParameters": {
            "broker": "mock",
            "account_id": "A1",
            "client_order_id": "order-1",
        }
    }
    get_resp = broker_get_order_handler(
        get_event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert get_resp["statusCode"] == 200
    assert json.loads(get_resp["body"])["status"] == "submitted"

    cancel_event = {
        "queryStringParameters": {
            "broker": "mock",
            "account_id": "A1",
            "client_order_id": "order-1",
        }
    }
    cancel_resp = broker_cancel_order_handler(
        cancel_event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert cancel_resp["statusCode"] == 200
    assert json.loads(cancel_resp["body"])["cancelled"] is True


def test_broker_get_order_not_found_maps_to_404() -> None:
    event = {
        "queryStringParameters": {
            "broker": "mock",
            "account_id": "missing",
            "client_order_id": "order-1",
        }
    }
    response = broker_get_order_handler(
        event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert response["statusCode"] == 404


def test_broker_place_order_rejects_caller_supplied_gateway() -> None:
    event = {
        "queryStringParameters": {"broker": "mock", "account_id": "A1"},
        "body": json.dumps(
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "client_order_id": "order-1",
                "connect_config": {"gateway": {"bad": "input"}},
            }
        ),
    }
    response = broker_place_order_handler(
        event,
        {},
        factory=_FakeFactory,
        gateway_provider=_FakeGatewayProvider(),
    )
    assert response["statusCode"] == 400

