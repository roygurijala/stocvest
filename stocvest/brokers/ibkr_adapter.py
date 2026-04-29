"""Interactive Brokers (TWS / ib_insync) adapter.

Runtime notes:
- In production, this adapter expects an ib_insync-compatible gateway.
- In tests, callers can inject a fake gateway via connect(config={"gateway": ...}).
"""

from __future__ import annotations

from typing import Any, Protocol

from stocvest.brokers.adapter import BrokerAdapter
from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRejectedError,
    BrokerUnavailableError,
)
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    OrderBookLevel,
    OrderBookSnapshot,
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderSide,
    OrderStatus,
    OrderType,
    PlaceOrderRequest,
)


class IBKRGateway(Protocol):
    """Narrow gateway contract used by IBKRBrokerAdapter."""

    def connect(self, *, host: str, port: int, client_id: int, readonly: bool) -> None: ...
    def disconnect(self) -> None: ...
    def is_connected(self) -> bool: ...
    def list_accounts(self) -> list[dict[str, Any]]: ...
    def get_positions(self, account_id: str) -> list[dict[str, Any]]: ...
    def place_order(self, account_id: str, order: dict[str, Any]) -> dict[str, Any]: ...
    def cancel_order(self, account_id: str, client_order_id: str) -> None: ...
    def get_order(self, account_id: str, client_order_id: str) -> dict[str, Any] | None: ...
    def subscribe_level2(self, symbol: str) -> None: ...
    def unsubscribe_level2(self, symbol: str) -> None: ...
    def get_order_book(self, symbol: str) -> dict[str, Any] | None: ...


class IBKRBrokerAdapter(BrokerAdapter):
    """IBKR adapter using a pluggable gateway (ib_insync-backed in production)."""

    def __init__(self) -> None:
        super().__init__()
        self._gateway: IBKRGateway | None = None
        self._level2_subscriptions: set[str] = set()

    async def connect(self, config: dict[str, Any]) -> None:
        self._configure_pdt_enforcer(config)
        gateway = config.get("gateway")
        if gateway is None:
            raise BrokerUnavailableError(
                "IBKR gateway not configured. Pass connect(config={...,'gateway': <ibkr gateway>})."
            )
        self._gateway = gateway
        try:
            self._gateway.connect(
                host=str(config.get("host", "127.0.0.1")),
                port=int(config.get("port", 7497)),
                client_id=int(config.get("client_id", 1)),
                readonly=bool(config.get("readonly", False)),
            )
        except BrokerAuthError:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            if "auth" in msg or "permission" in msg:
                raise BrokerAuthError(f"IBKR auth failed: {exc}") from exc
            raise BrokerUnavailableError(f"IBKR connection failed: {exc}") from exc

    async def disconnect(self) -> None:
        if self._gateway is None:
            return
        try:
            self._gateway.disconnect()
        finally:
            self._level2_subscriptions.clear()
            self._gateway = None

    async def health_check(self) -> BrokerHealth:
        if self._gateway is None:
            return BrokerHealth(ok=False, message="not connected")
        return BrokerHealth(
            ok=bool(self._gateway.is_connected()),
            message="ok" if self._gateway.is_connected() else "disconnected",
        )

    async def list_accounts(self) -> list[BrokerAccount]:
        gw = self._require_gateway()
        rows = gw.list_accounts()
        return [
            BrokerAccount(
                account_id=str(row["account_id"]),
                display_name=row.get("display_name"),
            )
            for row in rows
        ]

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        gw = self._require_gateway()
        try:
            rows = gw.get_positions(account_id)
        except Exception as exc:
            if "account" in str(exc).lower() and "not" in str(exc).lower():
                raise BrokerNotFoundError(f"Unknown IBKR account: {account_id}") from exc
            raise BrokerUnavailableError(f"IBKR positions error: {exc}") from exc
        return [
            BrokerPosition(
                symbol=str(row["symbol"]).upper(),
                quantity=float(row["quantity"]),
                avg_cost=float(row["avg_cost"]) if row.get("avg_cost") is not None else None,
            )
            for row in rows
        ]

    async def _place_order_impl(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        gw = self._require_gateway()
        if request.order_type == OrderType.LIMIT and request.limit_price is None:
            raise BrokerRejectedError("IBKR limit order requires limit_price")
        if request.order_type == OrderType.STOP and request.stop_price is None:
            raise BrokerRejectedError("IBKR stop order requires stop_price")
        payload = {
            "client_order_id": request.client_order_id,
            "symbol": request.symbol.upper(),
            "side": request.side.value,
            "quantity": request.quantity,
            "order_type": request.order_type.value,
            "time_in_force": request.time_in_force.value,
            "limit_price": request.limit_price,
            "stop_price": request.stop_price,
        }
        try:
            ack = gw.place_order(account_id, payload)
        except BrokerRejectedError:
            raise
        except Exception as exc:
            if "reject" in str(exc).lower():
                raise BrokerRejectedError(f"IBKR rejected order: {exc}") from exc
            raise BrokerUnavailableError(f"IBKR place_order failed: {exc}") from exc
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id=str(ack["broker_order_id"]) if ack.get("broker_order_id") else None,
        )

    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        gw = self._require_gateway()
        try:
            gw.cancel_order(account_id, client_order_id)
        except BrokerNotFoundError:
            raise
        except Exception as exc:
            text = str(exc).lower()
            if "not found" in text:
                raise BrokerNotFoundError(f"Unknown order: {client_order_id}") from exc
            if "filled" in text or "cannot cancel" in text:
                raise BrokerRejectedError(f"IBKR cancellation rejected: {exc}") from exc
            raise BrokerUnavailableError(f"IBKR cancel failed: {exc}") from exc

    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        gw = self._require_gateway()
        row = gw.get_order(account_id, client_order_id)
        if row is None:
            raise BrokerNotFoundError(f"Unknown order: {client_order_id}")
        return OrderStatus(
            client_order_id=client_order_id,
            broker_order_id=str(row["broker_order_id"]) if row.get("broker_order_id") else None,
            status=self._map_status(str(row.get("status", "submitted"))),
            symbol=str(row["symbol"]).upper(),
            side=OrderSide(str(row["side"])),
            quantity_ordered=float(row["quantity_ordered"]),
            quantity_filled=float(row.get("quantity_filled", 0.0)),
            average_fill_price=float(row["average_fill_price"])
            if row.get("average_fill_price") is not None
            else None,
            reject_reason=row.get("reject_reason"),
        )

    async def subscribe_level2(self, symbol: str) -> None:
        gw = self._require_gateway()
        sym = symbol.upper()
        try:
            gw.subscribe_level2(sym)
        except Exception as exc:
            raise BrokerUnavailableError(f"IBKR level2 subscribe failed: {exc}") from exc
        self._level2_subscriptions.add(sym)

    async def unsubscribe_level2(self, symbol: str) -> None:
        gw = self._require_gateway()
        sym = symbol.upper()
        try:
            gw.unsubscribe_level2(sym)
        except Exception as exc:
            raise BrokerUnavailableError(f"IBKR level2 unsubscribe failed: {exc}") from exc
        self._level2_subscriptions.discard(sym)

    async def get_order_book(self, symbol: str) -> OrderBookSnapshot:
        gw = self._require_gateway()
        sym = symbol.upper()
        row = gw.get_order_book(sym)
        if row is None:
            raise BrokerNotFoundError(f"No order book available for symbol: {sym}")

        bids = [
            OrderBookLevel(
                price=float(level["price"]),
                size=float(level["size"]),
                market_maker=level.get("market_maker"),
            )
            for level in row.get("bids", [])
        ]
        asks = [
            OrderBookLevel(
                price=float(level["price"]),
                size=float(level["size"]),
                market_maker=level.get("market_maker"),
            )
            for level in row.get("asks", [])
        ]
        return OrderBookSnapshot(symbol=sym, bids=bids, asks=asks)

    def _require_gateway(self) -> IBKRGateway:
        if self._gateway is None:
            raise BrokerAuthError("IBKR adapter is not connected")
        return self._gateway

    @staticmethod
    def _map_status(raw: str) -> OrderLifecycleStatus:
        norm = raw.strip().lower().replace(" ", "_")
        mapping = {
            "pending": OrderLifecycleStatus.PENDING,
            "presubmitted": OrderLifecycleStatus.PENDING,
            "submitted": OrderLifecycleStatus.SUBMITTED,
            "partially_filled": OrderLifecycleStatus.PARTIALLY_FILLED,
            "filled": OrderLifecycleStatus.FILLED,
            "cancelled": OrderLifecycleStatus.CANCELLED,
            "canceled": OrderLifecycleStatus.CANCELLED,
            "rejected": OrderLifecycleStatus.REJECTED,
            "inactive": OrderLifecycleStatus.REJECTED,
        }
        return mapping.get(norm, OrderLifecycleStatus.SUBMITTED)
