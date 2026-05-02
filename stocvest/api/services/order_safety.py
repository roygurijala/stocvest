"""Pre-trade validation: PDT, buying power estimate, market hours, symbol, quantity."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from stocvest.brokers.exceptions import (
    InsufficientFundsError,
    MarketClosedError,
    OrderQuantityLimitError,
    PDTViolationError,
    UnknownSymbolError,
)
from stocvest.brokers.models import OrderSide, OrderType, PlaceOrderRequest
from stocvest.data.models import MarketStatus, Snapshot
from stocvest.signals.pdt_tracker import PDTTracker, PDTUserState

if TYPE_CHECKING:
    from stocvest.data.polygon_client import PolygonClient


@dataclass
class OrderAccountState:
    """Caller-supplied account snapshot for validation (no broker secrets)."""

    trading_mode_is_paper: bool
    available_cash: float
    is_day_trade: bool = True
    pdt_state: PDTUserState | None = None


@dataclass
class ValidationResult:
    is_valid: bool
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    estimated_cost: float = 0.0
    estimated_value: float = 0.0
    pdt_trades_used: int = 0
    pdt_trades_remaining: int = 3
    is_paper_mode: bool = False
    current_bid: float = 0.0
    current_ask: float = 0.0
    spread_pct: float = 0.0


class OrderSafetyGate:
    """Fail-fast checks before routing an order to a broker adapter."""

    def __init__(
        self,
        polygon: PolygonClient,
        *,
        max_order_quantity: float = 10_000.0,
        cost_buffer_pct: float = 0.02,
    ) -> None:
        self._polygon = polygon
        self._max_order_quantity = max_order_quantity
        self._cost_buffer_pct = cost_buffer_pct
        self._pdt = PDTTracker()

    async def validate_order(
        self,
        user_id: str,
        order: PlaceOrderRequest,
        account_state: OrderAccountState,
        *,
        as_of: date | None = None,
    ) -> ValidationResult:
        _ = user_id
        warnings: list[str] = []
        errors: list[str] = []
        is_paper = account_state.trading_mode_is_paper

        if order.quantity > self._max_order_quantity:
            raise OrderQuantityLimitError(
                f"Order quantity exceeds the maximum allowed ({self._max_order_quantity:,.0f} shares)."
            )

        market_status = await self._polygon.get_market_status()
        nyse = _nyse_session(market_status)

        if order.order_type == OrderType.MARKET and not _is_regular_hours(nyse):
            raise MarketClosedError(
                "Market orders are only accepted during regular trading hours. "
                "Use a limit order for extended hours, or wait until the market opens."
            )
        if order.order_type == OrderType.LIMIT and not _is_extended_ok(nyse):
            raise MarketClosedError("Market is closed. Limit orders require the session to be open or in extended hours.")

        details = await self._polygon.get_ticker_details(order.symbol.upper())
        if not details or not _is_equity_type(details.get("type")):
            raise UnknownSymbolError(f"Unknown or unsupported equity symbol: {order.symbol.upper()}")

        snap = await self._polygon.get_snapshot(order.symbol.upper())
        bid, ask, mid = _quote_mid(snap)
        spread_pct = ((ask - bid) / mid * 100.0) if mid > 0 and ask >= bid else 0.0

        estimated_value = float(order.quantity) * mid
        estimated_cost = estimated_value * (1.0 + self._cost_buffer_pct)

        used = 0
        remaining = 3
        if account_state.is_day_trade and account_state.pdt_state is not None:
            assessment = self._pdt.assess(account_state.pdt_state, as_of=as_of or date.today())
            used = assessment.day_trades_in_window
            remaining = max(0, assessment.max_non_exempt - used)
            if not assessment.pdt_exempt and used >= 3:
                raise PDTViolationError(
                    "Pattern day trading limit reached: you already have 3 day trades in the "
                    "current 5-business-day window. This order cannot be placed unless your "
                    "account is PDT-exempt."
                )
            if not assessment.pdt_exempt and used == 2:
                warnings.append("PDT: 2 of 3 day trades already used this week — one slot left.")

        if order.side == OrderSide.BUY and not is_paper:
            if estimated_cost > account_state.available_cash:
                raise InsufficientFundsError(
                    "Insufficient buying power: estimated cost including a small buffer exceeds "
                    "available cash in the account snapshot you provided."
                )

        is_valid = len(errors) == 0
        return ValidationResult(
            is_valid=is_valid,
            warnings=warnings,
            errors=errors,
            estimated_cost=estimated_cost if order.side == OrderSide.BUY else estimated_value,
            estimated_value=estimated_value,
            pdt_trades_used=used,
            pdt_trades_remaining=remaining,
            is_paper_mode=is_paper,
            current_bid=bid,
            current_ask=ask,
            spread_pct=round(spread_pct, 4),
        )


def _nyse_session(status: MarketStatus) -> str:
    ex = status.exchanges or {}
    raw = ex.get("NYSE") or ex.get("nyse") or ex.get("Nasdaq") or ex.get("NASDAQ") or ""
    return str(raw).strip().lower().replace(" ", "_")


def _is_regular_hours(nyse: str) -> bool:
    return nyse == "open"


def _is_extended_ok(nyse: str) -> bool:
    return nyse in {"open", "extended_hours", "extended-hours", "extended"}


def _is_equity_type(type_raw: object) -> bool:
    if type_raw is None:
        return False
    t = str(type_raw).upper()
    return t in {"CS", "ADRC", "ADRP", "ETF", "ETN", "ETV", "ETS"}


def _quote_mid(snap: Snapshot) -> tuple[float, float, float]:
    bid = float(snap.last_quote_bid or 0.0)
    ask = float(snap.last_quote_ask or 0.0)
    last = float(snap.last_trade_price or 0.0)
    if bid > 0 and ask > 0:
        mid = (bid + ask) / 2.0
        return bid, ask, mid
    if last > 0:
        if bid <= 0:
            bid = last
        if ask <= 0:
            ask = last
        return bid, ask, last
    raise UnknownSymbolError("Unable to price this symbol — missing quote data.")
