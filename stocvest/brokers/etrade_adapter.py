"""E*TRADE OAuth REST adapter.

Like IBKR adapter, this uses an injectable gateway so tests can run without
live credentials/network. In production, provide a gateway backed by OAuth REST.
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
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderSide,
    OrderStatus,
    OrderType,
    PlaceOrderRequest,
)


class ETradeGateway(Protocol):
    def connect(self, *, consumer_key: str, consumer_secret: str, sandbox: bool) -> None: ...
    def disconnect(self) -> None: ...
    def is_connected(self) -> bool: ...
    def list_accounts(self) -> list[dict[str, Any]]: ...
    def get_positions(self, account_id: str) -> list[dict[str, Any]]: ...
    def place_order(self, account_id: str, order: dict[str, Any]) -> dict[str, Any]: ...
    def cancel_order(self, account_id: str, client_order_id: str) -> None: ...
    def get_order(self, account_id: str, client_order_id: str) -> dict[str, Any] | None: ...


class ETradeBrokerAdapter(BrokerAdapter):
    def __init__(self) -> None:
        super().__init__()
        self._gateway: ETradeGateway | None = None

    async def connect(self, config: dict[str, Any]) -> None:
        self._configure_pdt_enforcer(config)
        gateway = config.get("gateway")
        if gateway is None:
            raise BrokerUnavailableError(
                "E*TRADE gateway not configured. Pass connect(config={...,'gateway': <etrade gateway>})."
            )
        self._gateway = gateway
        try:
            self._gateway.connect(
                consumer_key=str(config.get("consumer_key", "")),
                consumer_secret=str(config.get("consumer_secret", "")),
                sandbox=bool(config.get("sandbox", True)),
            )
            oauth_token = config.get("oauth_token")
            if oauth_token and hasattr(self._gateway, "set_access_token"):
                # Optional convenience path for HTTP gateways.
                getattr(self._gateway, "set_access_token")(str(oauth_token))
        except BrokerAuthError:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            if "auth" in msg or "oauth" in msg or "token" in msg:
                raise BrokerAuthError(f"E*TRADE auth failed: {exc}") from exc
            raise BrokerUnavailableError(f"E*TRADE connection failed: {exc}") from exc

    async def disconnect(self) -> None:
        if self._gateway is None:
            return
        try:
            self._gateway.disconnect()
        finally:
            self._gateway = None

    async def health_check(self) -> BrokerHealth:
        if self._gateway is None:
            return BrokerHealth(ok=False, message="not connected")
        ok = bool(self._gateway.is_connected())
        return BrokerHealth(ok=ok, message="ok" if ok else "disconnected")

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
            if "not found" in str(exc).lower() or "unknown" in str(exc).lower():
                raise BrokerNotFoundError(f"Unknown E*TRADE account: {account_id}") from exc
            raise BrokerUnavailableError(f"E*TRADE positions error: {exc}") from exc
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
            raise BrokerRejectedError("E*TRADE limit order requires limit_price")
        if request.order_type == OrderType.STOP and request.stop_price is None:
            raise BrokerRejectedError("E*TRADE stop order requires stop_price")
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
                raise BrokerRejectedError(f"E*TRADE rejected order: {exc}") from exc
            raise BrokerUnavailableError(f"E*TRADE place_order failed: {exc}") from exc
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id=str(ack["broker_order_id"]) if ack.get("broker_order_id") else None,
        )

    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        gw = self._require_gateway()
        try:
            gw.cancel_order(account_id, client_order_id)
        except Exception as exc:
            text = str(exc).lower()
            if "not found" in text or "unknown" in text:
                raise BrokerNotFoundError(f"Unknown order: {client_order_id}") from exc
            if "cannot cancel" in text or "filled" in text:
                raise BrokerRejectedError(f"E*TRADE cancellation rejected: {exc}") from exc
            raise BrokerUnavailableError(f"E*TRADE cancel failed: {exc}") from exc

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

    def _require_gateway(self) -> ETradeGateway:
        if self._gateway is None:
            raise BrokerAuthError("E*TRADE adapter is not connected")
        return self._gateway

    @staticmethod
    def _map_status(raw: str) -> OrderLifecycleStatus:
        norm = raw.strip().lower().replace(" ", "_")
        mapping = {
            "pending": OrderLifecycleStatus.PENDING,
            "submitted": OrderLifecycleStatus.SUBMITTED,
            "partially_filled": OrderLifecycleStatus.PARTIALLY_FILLED,
            "filled": OrderLifecycleStatus.FILLED,
            "cancelled": OrderLifecycleStatus.CANCELLED,
            "canceled": OrderLifecycleStatus.CANCELLED,
            "rejected": OrderLifecycleStatus.REJECTED,
        }
        return mapping.get(norm, OrderLifecycleStatus.SUBMITTED)
