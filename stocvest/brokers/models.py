"""Broker DTOs — normalized across IBKR, E*TRADE, and Mock adapters."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class TimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderLifecycleStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class BrokerAccount(BaseModel):
    account_id: str
    display_name: str | None = None


class BrokerPosition(BaseModel):
    symbol: str
    quantity: float = Field(description="Signed: positive long, negative short")
    avg_cost: float | None = None


class BrokerHealth(BaseModel):
    ok: bool
    message: str | None = None


class OrderBookLevel(BaseModel):
    price: float
    size: float
    market_maker: str | None = None


class OrderBookSnapshot(BaseModel):
    symbol: str
    bids: list[OrderBookLevel] = Field(default_factory=list)
    asks: list[OrderBookLevel] = Field(default_factory=list)


class PlaceOrderRequest(BaseModel):
    symbol: str
    side: OrderSide
    quantity: float = Field(gt=0)
    order_type: OrderType
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: float | None = None
    stop_price: float | None = None
    client_order_id: str = Field(min_length=1)


class OrderAck(BaseModel):
    client_order_id: str
    broker_order_id: str | None = None
    average_fill_price: float | None = None
    quantity_filled: float | None = None


class OrderStatus(BaseModel):
    client_order_id: str
    broker_order_id: str | None = None
    status: OrderLifecycleStatus
    symbol: str
    side: OrderSide
    quantity_ordered: float
    quantity_filled: float = 0.0
    average_fill_price: float | None = None
    reject_reason: str | None = None
