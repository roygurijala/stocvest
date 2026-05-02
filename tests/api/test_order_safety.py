from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from stocvest.api.services.order_safety import OrderAccountState, OrderSafetyGate
from stocvest.brokers.exceptions import (
    InsufficientFundsError,
    MarketClosedError,
    OrderQuantityLimitError,
    PDTViolationError,
    UnknownSymbolError,
)
from stocvest.brokers.models import OrderSide, OrderType, PlaceOrderRequest
from stocvest.data.models import MarketStatus, Snapshot
from stocvest.signals.pdt_tracker import PDTUserState


class _FakePolygon:
    def __init__(
        self,
        *,
        nyse: str = "open",
        ticker_type: str = "CS",
        bid: float = 100.0,
        ask: float = 100.2,
        last: float = 100.1,
        empty_details: bool = False,
    ) -> None:
        self._nyse = nyse
        self._ticker_type = ticker_type
        self._bid = bid
        self._ask = ask
        self._last = last
        self._empty_details = empty_details

    async def get_market_status(self) -> MarketStatus:
        return MarketStatus(
            market="stocks",
            server_time=datetime.now(tz=timezone.utc),
            exchanges={"NYSE": self._nyse},
            currencies={},
        )

    async def get_ticker_details(self, symbol: str) -> dict:
        if self._empty_details:
            return {}
        return {"type": self._ticker_type, "ticker": symbol}

    async def get_snapshot(self, symbol: str) -> Snapshot:
        return Snapshot(
            symbol=symbol,
            last_quote_bid=self._bid,
            last_quote_ask=self._ask,
            last_trade_price=self._last,
        )


def _req(qty: float = 10.0, *, otype: OrderType = OrderType.MARKET) -> PlaceOrderRequest:
    return PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=qty,
        order_type=otype,
        client_order_id="c1",
    )


@pytest.mark.asyncio
async def test_pdt_block_at_3_trades() -> None:
    gate = OrderSafetyGate(_FakePolygon())
    state = PDTUserState(
        user_id="u1",
        day_trade_dates=(date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)),
        pdt_exempt=False,
    )
    acct = OrderAccountState(
        trading_mode_is_paper=True,
        available_cash=1_000_000.0,
        is_day_trade=True,
        pdt_state=state,
    )
    with pytest.raises(PDTViolationError):
        await gate.validate_order("u1", _req(), acct, as_of=date(2026, 4, 29))


@pytest.mark.asyncio
async def test_pdt_warning_at_2_trades() -> None:
    gate = OrderSafetyGate(_FakePolygon())
    state = PDTUserState(
        user_id="u1",
        day_trade_dates=(date(2026, 4, 28), date(2026, 4, 29)),
        pdt_exempt=False,
    )
    acct = OrderAccountState(
        trading_mode_is_paper=True,
        available_cash=1_000_000.0,
        is_day_trade=True,
        pdt_state=state,
    )
    res = await gate.validate_order("u1", _req(), acct, as_of=date(2026, 4, 29))
    assert any("2 of 3" in w for w in res.warnings)
    assert res.pdt_trades_used == 2


@pytest.mark.asyncio
async def test_paper_mode_flag_in_result() -> None:
    gate = OrderSafetyGate(_FakePolygon())
    acct = OrderAccountState(
        trading_mode_is_paper=True,
        available_cash=0.0,
        is_day_trade=False,
        pdt_state=None,
    )
    res = await gate.validate_order("u1", _req(), acct)
    assert res.is_paper_mode is True


@pytest.mark.asyncio
async def test_market_order_rejected_outside_hours() -> None:
    gate = OrderSafetyGate(_FakePolygon(nyse="closed"))
    acct = OrderAccountState(True, 1_000_000.0, False, None)
    with pytest.raises(MarketClosedError):
        await gate.validate_order("u1", _req(otype=OrderType.MARKET), acct)


@pytest.mark.asyncio
async def test_limit_allowed_extended_hours() -> None:
    gate = OrderSafetyGate(_FakePolygon(nyse="extended_hours"))
    acct = OrderAccountState(True, 1_000_000.0, False, None)
    res = await gate.validate_order("u1", _req(otype=OrderType.LIMIT), acct)
    assert res.is_valid


@pytest.mark.asyncio
async def test_insufficient_funds_rejected() -> None:
    gate = OrderSafetyGate(_FakePolygon())
    acct = OrderAccountState(
        trading_mode_is_paper=False,
        available_cash=100.0,
        is_day_trade=False,
        pdt_state=None,
    )
    with pytest.raises(InsufficientFundsError):
        await gate.validate_order("u1", _req(100.0), acct)


@pytest.mark.asyncio
async def test_quantity_over_limit_rejected() -> None:
    gate = OrderSafetyGate(_FakePolygon(), max_order_quantity=1000)
    acct = OrderAccountState(True, 1e9, False, None)
    with pytest.raises(OrderQuantityLimitError):
        await gate.validate_order("u1", _req(5000.0), acct)


@pytest.mark.asyncio
async def test_unknown_symbol_rejected() -> None:
    gate = OrderSafetyGate(_FakePolygon(empty_details=True))
    acct = OrderAccountState(True, 1e9, False, None)
    with pytest.raises(UnknownSymbolError):
        await gate.validate_order("u1", _req(), acct)


@pytest.mark.asyncio
async def test_valid_order_passes_all_gates() -> None:
    gate = OrderSafetyGate(_FakePolygon())
    acct = OrderAccountState(True, 1e9, False, None)
    res = await gate.validate_order("u1", _req(), acct)
    assert res.is_valid
    assert res.current_bid > 0
    assert res.spread_pct >= 0
