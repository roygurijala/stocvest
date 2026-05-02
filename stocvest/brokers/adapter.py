"""Abstract broker adapter — eight async operations (immutable contract surface)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Protocol

from stocvest.brokers.exceptions import OrderRejectedError
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderStatus,
    PlaceOrderRequest,
)


class BrokerPDTEnforcer(Protocol):
    async def assert_can_place_order(self, account_id: str, request: PlaceOrderRequest) -> None: ...


class BrokerAdapter(ABC):
    """
    Normalized multi-broker interface.

    All methods are async so HTTP/TWS bridges can share the same call shape.
    Credentials are loaded outside the adapter (Secrets Manager); pass opaque
    config into ``connect``.
    """

    @abstractmethod
    async def connect(self, config: dict[str, Any]) -> None:
        """Establish session using caller-supplied non-secret handles + secret refs."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Release sessions, sockets, and background tasks."""

    @abstractmethod
    async def health_check(self) -> BrokerHealth:
        """Cheap liveness check after connect."""

    @abstractmethod
    async def list_accounts(self) -> list[BrokerAccount]:
        """Trading accounts available to this connection."""

    @abstractmethod
    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        """Open positions for the account."""

    def __init__(self) -> None:
        self._pdt_enforcer: BrokerPDTEnforcer | None = None
        self._order_safety_gate: Any | None = None
        self._order_safety_user_id: str | None = None
        self._order_safety_account_state: Any | None = None

    def _configure_pdt_enforcer(self, config: dict[str, Any]) -> None:
        """Optional pdt_enforcer in connect() config for hard pre-submit checks."""
        enforcer = config.get("pdt_enforcer")
        self._pdt_enforcer = enforcer

    def _configure_order_safety(self, config: dict[str, Any]) -> None:
        """Optional OrderSafetyGate + account snapshot (set by API handlers)."""
        self._order_safety_gate = config.get("order_safety_gate")
        self._order_safety_user_id = config.get("order_safety_user_id")
        self._order_safety_account_state = config.get("order_safety_account_state")

    async def place_order(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        """
        Submit an order with mandatory broker-layer PDT pre-check hook.

        Every adapter routes here and only implements `_place_order_impl`.
        """
        if self._order_safety_gate is not None and self._order_safety_account_state is not None:
            from stocvest.utils.logging import get_logger

            log = get_logger(__name__)
            paper = bool(getattr(self._order_safety_account_state, "trading_mode_is_paper", False))
            log.info(
                "order_attempt user=%s symbol=%s side=%s qty=%s paper_live=%s",
                self._order_safety_user_id or "",
                request.symbol,
                request.side.value,
                request.quantity,
                "paper" if paper else "live",
            )
            result = await self._order_safety_gate.validate_order(
                self._order_safety_user_id or "",
                request,
                self._order_safety_account_state,
            )
            if not result.is_valid:
                raise OrderRejectedError("Order failed pre-trade validation.", result)
        if self._pdt_enforcer is not None:
            await self._pdt_enforcer.assert_can_place_order(account_id, request)
        return await self._place_order_impl(account_id, request)

    @abstractmethod
    async def _place_order_impl(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        """Adapter-specific submit implementation called after PDT enforcement."""

    @abstractmethod
    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        """Request cancellation for an open order."""

    @abstractmethod
    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        """Return latest known state for the order."""
