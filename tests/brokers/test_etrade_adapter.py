from __future__ import annotations

import pytest

from stocvest.brokers.etrade_adapter import ETradeBrokerAdapter
from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRejectedError,
)
from stocvest.brokers.models import OrderLifecycleStatus, OrderSide, OrderType, PlaceOrderRequest


class FakeETradeGateway:
    def __init__(self) -> None:
        self.connected = False
        self._accounts = [{"account_id": "ETR-1", "display_name": "Sandbox"}]
        self._positions = {"ETR-1": [{"symbol": "AAPL", "quantity": 4.0, "avg_cost": 180.0}]}
        self._orders: dict[str, dict] = {}

    def connect(self, *, consumer_key: str, consumer_secret: str, sandbox: bool) -> None:
        if consumer_key == "bad":
            raise RuntimeError("oauth auth failed")
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    def set_access_token(self, token: str) -> None:
        # Compatibility hook for adapter convenience path.
        self._token = token

    def list_accounts(self) -> list[dict]:
        return list(self._accounts)

    def get_positions(self, account_id: str) -> list[dict]:
        if account_id not in self._positions:
            raise RuntimeError("unknown account")
        return list(self._positions[account_id])

    def place_order(self, account_id: str, order: dict) -> dict:
        if account_id not in self._positions:
            raise RuntimeError("unknown account")
        if order["client_order_id"] in self._orders:
            return {"broker_order_id": self._orders[order["client_order_id"]]["broker_order_id"]}
        row = {
            "broker_order_id": f"ETR-{order['client_order_id']}",
            "symbol": order["symbol"],
            "side": order["side"],
            "status": "submitted",
            "quantity_ordered": order["quantity"],
            "quantity_filled": 0.0,
            "average_fill_price": None,
            "reject_reason": None,
        }
        self._orders[order["client_order_id"]] = row
        return {"broker_order_id": row["broker_order_id"]}

    def cancel_order(self, account_id: str, client_order_id: str) -> None:
        row = self._orders.get(client_order_id)
        if row is None:
            raise RuntimeError("not found")
        if row["status"] == "filled":
            raise RuntimeError("cannot cancel filled")
        row["status"] = "cancelled"

    def get_order(self, account_id: str, client_order_id: str) -> dict | None:
        return self._orders.get(client_order_id)


@pytest.mark.unit
async def test_etrade_connect_health_disconnect() -> None:
    adapter = ETradeBrokerAdapter()
    gw = FakeETradeGateway()
    await adapter.connect({"gateway": gw, "consumer_key": "ok", "consumer_secret": "secret"})
    assert (await adapter.health_check()).ok is True
    await adapter.disconnect()
    assert (await adapter.health_check()).ok is False


@pytest.mark.unit
async def test_etrade_connect_sets_optional_oauth_token_when_supported() -> None:
    adapter = ETradeBrokerAdapter()
    gw = FakeETradeGateway()
    await adapter.connect({"gateway": gw, "consumer_key": "ok", "oauth_token": "tok123"})
    assert getattr(gw, "_token", None) == "tok123"


@pytest.mark.unit
async def test_etrade_auth_error_mapping() -> None:
    adapter = ETradeBrokerAdapter()
    with pytest.raises(BrokerAuthError):
        await adapter.connect({"gateway": FakeETradeGateway(), "consumer_key": "bad"})


@pytest.mark.unit
async def test_etrade_accounts_positions_and_order_flow() -> None:
    adapter = ETradeBrokerAdapter()
    await adapter.connect({"gateway": FakeETradeGateway(), "consumer_key": "ok"})
    accounts = await adapter.list_accounts()
    assert accounts[0].account_id == "ETR-1"
    positions = await adapter.get_positions("ETR-1")
    assert positions[0].symbol == "AAPL"

    req = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=3.0,
        order_type=OrderType.LIMIT,
        limit_price=300.0,
        client_order_id="e1",
    )
    ack = await adapter.place_order("ETR-1", req)
    assert ack.broker_order_id == "ETR-e1"
    st = await adapter.get_order("ETR-1", "e1")
    assert st.status == OrderLifecycleStatus.SUBMITTED
    await adapter.cancel_order("ETR-1", "e1")
    st2 = await adapter.get_order("ETR-1", "e1")
    assert st2.status == OrderLifecycleStatus.CANCELLED


@pytest.mark.unit
async def test_etrade_unknown_account_positions() -> None:
    adapter = ETradeBrokerAdapter()
    await adapter.connect({"gateway": FakeETradeGateway(), "consumer_key": "ok"})
    with pytest.raises(BrokerNotFoundError):
        await adapter.get_positions("NONE")


@pytest.mark.unit
async def test_etrade_rejects_invalid_limit_stop_request() -> None:
    adapter = ETradeBrokerAdapter()
    await adapter.connect({"gateway": FakeETradeGateway(), "consumer_key": "ok"})
    bad_limit = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.LIMIT,
        client_order_id="b1",
    )
    with pytest.raises(BrokerRejectedError, match="limit"):
        await adapter.place_order("ETR-1", bad_limit)

    bad_stop = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.STOP,
        client_order_id="b2",
    )
    with pytest.raises(BrokerRejectedError, match="stop"):
        await adapter.place_order("ETR-1", bad_stop)

