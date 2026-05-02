"""In-memory broker for unit tests and local development."""

from __future__ import annotations

import uuid
from typing import Any

from stocvest.brokers.adapter import BrokerAdapter
from stocvest.brokers.exceptions import BrokerAuthError, BrokerNotFoundError, BrokerRejectedError
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderStatus,
    OrderType,
    PlaceOrderRequest,
)


class MockBrokerAdapter(BrokerAdapter):
    """
    Deterministic mock: stores positions and orders in memory.

    ``connect`` expects ``config`` may include:
      - ``accounts``: list[dict] with ``account_id`` and optional ``display_name``
      - ``positions``: dict[account_id, list[BrokerPosition | dict]] initial positions
    """

    def __init__(self) -> None:
        super().__init__()
        self._connected = False
        self._accounts: list[BrokerAccount] = []
        self._positions: dict[str, list[BrokerPosition]] = {}
        self._orders: dict[str, OrderStatus] = {}

    async def connect(self, config: dict[str, Any]) -> None:
        self._configure_pdt_enforcer(config)
        self._configure_order_safety(config)
        if config.get("fail_auth"):
            raise BrokerAuthError("Mock auth failure")
        raw_accounts = config.get("accounts") or [{"account_id": "MOCK-1", "display_name": "Paper"}]
        self._accounts = [
            BrokerAccount(account_id=str(a["account_id"]), display_name=a.get("display_name"))
            for a in raw_accounts
        ]
        self._positions = {acc.account_id: [] for acc in self._accounts}
        for acc in self._accounts:
            for p in config.get("positions", {}).get(acc.account_id, []):
                if isinstance(p, BrokerPosition):
                    self._positions[acc.account_id].append(p)
                else:
                    self._positions[acc.account_id].append(BrokerPosition.model_validate(p))
        self._orders.clear()
        self._connected = True

    async def disconnect(self) -> None:
        self._connected = False
        self._accounts.clear()
        self._positions.clear()
        self._orders.clear()

    async def health_check(self) -> BrokerHealth:
        if not self._connected:
            return BrokerHealth(ok=False, message="not connected")
        return BrokerHealth(ok=True, message="mock")

    async def list_accounts(self) -> list[BrokerAccount]:
        self._require_connected()
        return list(self._accounts)

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        self._require_connected()
        if account_id not in self._positions:
            raise BrokerNotFoundError(f"Unknown account: {account_id}")
        return list(self._positions[account_id])

    async def _place_order_impl(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        self._require_connected()
        if account_id not in self._positions:
            raise BrokerNotFoundError(f"Unknown account: {account_id}")
        if request.order_type == OrderType.LIMIT and request.limit_price is None:
            raise BrokerRejectedError("limit order requires limit_price")
        if request.order_type == OrderType.STOP and request.stop_price is None:
            raise BrokerRejectedError("stop order requires stop_price")
        if request.client_order_id in self._orders:
            existing = self._orders[request.client_order_id]
            return OrderAck(client_order_id=request.client_order_id, broker_order_id=existing.broker_order_id)

        broker_id = f"B-{uuid.uuid4().hex[:12]}"
        self._orders[request.client_order_id] = OrderStatus(
            client_order_id=request.client_order_id,
            broker_order_id=broker_id,
            status=OrderLifecycleStatus.FILLED if request.order_type == OrderType.MARKET else OrderLifecycleStatus.SUBMITTED,
            symbol=request.symbol.upper(),
            side=request.side,
            quantity_ordered=request.quantity,
            quantity_filled=request.quantity if request.order_type == OrderType.MARKET else 0.0,
            average_fill_price=100.0 if request.order_type == OrderType.MARKET else None,
        )
        if request.order_type == OrderType.MARKET:
            self._apply_fill(account_id, request)
        return OrderAck(client_order_id=request.client_order_id, broker_order_id=broker_id)

    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        self._require_connected()
        if account_id not in self._positions:
            raise BrokerNotFoundError(f"Unknown account: {account_id}")
        order = self._orders.get(client_order_id)
        if order is None:
            raise BrokerNotFoundError(f"Unknown order: {client_order_id}")
        if order.status == OrderLifecycleStatus.FILLED:
            raise BrokerRejectedError("cannot cancel filled order")
        self._orders[client_order_id] = order.model_copy(
            update={"status": OrderLifecycleStatus.CANCELLED},
        )

    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        self._require_connected()
        if account_id not in self._positions:
            raise BrokerNotFoundError(f"Unknown account: {account_id}")
        order = self._orders.get(client_order_id)
        if order is None:
            raise BrokerNotFoundError(f"Unknown order: {client_order_id}")
        return order

    def _require_connected(self) -> None:
        if not self._connected:
            raise BrokerAuthError("not connected")

    def _apply_fill(self, account_id: str, request: PlaceOrderRequest) -> None:
        """Update mock positions for a simple market fill at placeholder price."""
        price = 100.0
        positions = self._positions[account_id]
        sym = request.symbol.upper()
        delta = request.quantity if request.side.value == "buy" else -request.quantity
        for i, p in enumerate(positions):
            if p.symbol.upper() == sym:
                new_qty = p.quantity + delta
                if abs(new_qty) < 1e-9:
                    positions.pop(i)
                else:
                    positions[i] = p.model_copy(update={"quantity": new_qty, "avg_cost": price})
                return
        if abs(delta) >= 1e-9:
            positions.append(BrokerPosition(symbol=sym, quantity=delta, avg_cost=price))
