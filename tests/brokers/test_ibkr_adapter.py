from __future__ import annotations

import pytest

from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRejectedError,
)
from stocvest.brokers.ibkr_adapter import IBKRBrokerAdapter
from stocvest.brokers.models import OrderLifecycleStatus, OrderSide, OrderType, PlaceOrderRequest


class FakeIBKRGateway:
    def __init__(self) -> None:
        self.connected = False
        self._accounts = [{"account_id": "DU123", "display_name": "Paper"}]
        self._positions = {
            "DU123": [
                {"symbol": "AAPL", "quantity": 5.0, "avg_cost": 190.0},
            ]
        }
        self._orders: dict[str, dict] = {}
        self._books = {
            "AAPL": {
                "bids": [
                    {"price": 199.99, "size": 500, "market_maker": "ARCA"},
                    {"price": 199.98, "size": 400, "market_maker": "BATS"},
                ],
                "asks": [
                    {"price": 200.01, "size": 450, "market_maker": "NSDQ"},
                    {"price": 200.02, "size": 300, "market_maker": "EDGX"},
                ],
            }
        }
        self._subscribed: set[str] = set()

    def connect(self, *, host: str, port: int, client_id: int, readonly: bool) -> None:
        if host == "bad-auth":
            raise RuntimeError("auth failure")
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    def list_accounts(self) -> list[dict]:
        return list(self._accounts)

    def get_positions(self, account_id: str) -> list[dict]:
        if account_id not in self._positions:
            raise RuntimeError("account not found")
        return list(self._positions[account_id])

    def place_order(self, account_id: str, order: dict) -> dict:
        if account_id not in self._positions:
            raise RuntimeError("account not found")
        if order["client_order_id"] in self._orders:
            return self._orders[order["client_order_id"]]
        ack = {"broker_order_id": f"IB-{order['client_order_id']}"}
        self._orders[order["client_order_id"]] = {
            **ack,
            "symbol": order["symbol"],
            "side": order["side"],
            "status": "submitted",
            "quantity_ordered": order["quantity"],
            "quantity_filled": 0.0,
            "average_fill_price": None,
            "reject_reason": None,
        }
        return ack

    def cancel_order(self, account_id: str, client_order_id: str) -> None:
        row = self._orders.get(client_order_id)
        if row is None:
            raise RuntimeError("not found")
        if row["status"] == "filled":
            raise RuntimeError("cannot cancel filled")
        row["status"] = "cancelled"

    def get_order(self, account_id: str, client_order_id: str) -> dict | None:
        return self._orders.get(client_order_id)

    def subscribe_level2(self, symbol: str) -> None:
        self._subscribed.add(symbol)

    def unsubscribe_level2(self, symbol: str) -> None:
        self._subscribed.discard(symbol)

    def get_order_book(self, symbol: str) -> dict | None:
        return self._books.get(symbol)


@pytest.mark.unit
async def test_ibkr_connect_health_disconnect() -> None:
    gw = FakeIBKRGateway()
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": gw, "host": "127.0.0.1", "port": 7497, "client_id": 11})
    assert (await adapter.health_check()).ok is True
    await adapter.disconnect()
    assert (await adapter.health_check()).ok is False


@pytest.mark.unit
async def test_ibkr_auth_error_mapping() -> None:
    adapter = IBKRBrokerAdapter()
    with pytest.raises(BrokerAuthError):
        await adapter.connect({"gateway": FakeIBKRGateway(), "host": "bad-auth"})


@pytest.mark.unit
async def test_ibkr_accounts_and_positions() -> None:
    gw = FakeIBKRGateway()
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": gw})
    accounts = await adapter.list_accounts()
    assert [a.account_id for a in accounts] == ["DU123"]
    positions = await adapter.get_positions("DU123")
    assert positions[0].symbol == "AAPL"


@pytest.mark.unit
async def test_ibkr_positions_unknown_account() -> None:
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": FakeIBKRGateway()})
    with pytest.raises(BrokerNotFoundError):
        await adapter.get_positions("UNKNOWN")


@pytest.mark.unit
async def test_ibkr_place_get_cancel_order() -> None:
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": FakeIBKRGateway()})
    req = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=2.0,
        order_type=OrderType.LIMIT,
        limit_price=300.0,
        client_order_id="c-1",
    )
    ack = await adapter.place_order("DU123", req)
    assert ack.broker_order_id == "IB-c-1"
    status = await adapter.get_order("DU123", "c-1")
    assert status.status == OrderLifecycleStatus.SUBMITTED
    await adapter.cancel_order("DU123", "c-1")
    status2 = await adapter.get_order("DU123", "c-1")
    assert status2.status == OrderLifecycleStatus.CANCELLED


@pytest.mark.unit
async def test_ibkr_rejects_invalid_limit_stop_request() -> None:
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": FakeIBKRGateway()})
    bad_limit = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.LIMIT,
        client_order_id="bad1",
    )
    with pytest.raises(BrokerRejectedError, match="limit"):
        await adapter.place_order("DU123", bad_limit)

    bad_stop = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.STOP,
        client_order_id="bad2",
    )
    with pytest.raises(BrokerRejectedError, match="stop"):
        await adapter.place_order("DU123", bad_stop)


@pytest.mark.unit
async def test_ibkr_level2_subscribe_get_unsubscribe() -> None:
    gw = FakeIBKRGateway()
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": gw})

    await adapter.subscribe_level2("aapl")
    assert "AAPL" in gw._subscribed

    book = await adapter.get_order_book("AAPL")
    assert book.symbol == "AAPL"
    assert len(book.bids) == 2
    assert len(book.asks) == 2
    assert book.bids[0].price < book.asks[0].price

    await adapter.unsubscribe_level2("AAPL")
    assert "AAPL" not in gw._subscribed


@pytest.mark.unit
async def test_ibkr_get_order_book_missing_symbol_raises() -> None:
    adapter = IBKRBrokerAdapter()
    await adapter.connect({"gateway": FakeIBKRGateway()})
    with pytest.raises(BrokerNotFoundError, match="No order book"):
        await adapter.get_order_book("MSFT")

