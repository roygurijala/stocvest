from __future__ import annotations

from datetime import date

import pytest

from stocvest.brokers import AccountPDTEnforcer
from stocvest.brokers.exceptions import BrokerAuthError, BrokerNotFoundError, BrokerRejectedError
from stocvest.brokers.mock_adapter import MockBrokerAdapter
from stocvest.brokers.models import (
    BrokerPosition,
    OrderLifecycleStatus,
    OrderSide,
    OrderType,
    PlaceOrderRequest,
    TimeInForce,
)
from stocvest.signals.pdt_tracker import PDTUserState


@pytest.mark.unit
async def test_mock_connect_list_accounts_and_positions() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect(
        {
            "accounts": [{"account_id": "A1", "display_name": "Paper"}],
            "positions": {"A1": [{"symbol": "AAPL", "quantity": 10.0, "avg_cost": 150.0}]},
        }
    )
    assert (await adapter.health_check()).ok is True
    accounts = await adapter.list_accounts()
    assert len(accounts) == 1 and accounts[0].account_id == "A1"
    pos = await adapter.get_positions("A1")
    assert len(pos) == 1 and pos[0].symbol == "AAPL"


@pytest.mark.unit
async def test_mock_market_buy_updates_position() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect({})
    acc = (await adapter.list_accounts())[0].account_id
    req = PlaceOrderRequest(
        symbol="MSFT",
        side=OrderSide.BUY,
        quantity=5,
        order_type=OrderType.MARKET,
        time_in_force=TimeInForce.DAY,
        client_order_id="c1",
    )
    ack = await adapter.place_order(acc, req)
    assert ack.client_order_id == "c1"
    positions = await adapter.get_positions(acc)
    assert any(p.symbol == "MSFT" and p.quantity == 5 for p in positions)


@pytest.mark.unit
async def test_mock_place_order_idempotent_client_id() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect({})
    acc = (await adapter.list_accounts())[0].account_id
    req = PlaceOrderRequest(
        symbol="X",
        side=OrderSide.BUY,
        quantity=1,
        order_type=OrderType.MARKET,
        client_order_id="same",
    )
    a1 = await adapter.place_order(acc, req)
    a2 = await adapter.place_order(acc, req)
    assert a1.broker_order_id == a2.broker_order_id


@pytest.mark.unit
async def test_mock_cancel_limit_order() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect({})
    acc = (await adapter.list_accounts())[0].account_id
    req = PlaceOrderRequest(
        symbol="Y",
        side=OrderSide.BUY,
        quantity=2,
        order_type=OrderType.LIMIT,
        limit_price=50.0,
        client_order_id="L1",
    )
    await adapter.place_order(acc, req)
    await adapter.cancel_order(acc, "L1")
    st = await adapter.get_order(acc, "L1")
    assert st.status == OrderLifecycleStatus.CANCELLED


@pytest.mark.unit
async def test_mock_rejects_limit_without_price() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect({})
    acc = (await adapter.list_accounts())[0].account_id
    req = PlaceOrderRequest(
        symbol="Z",
        side=OrderSide.BUY,
        quantity=1,
        order_type=OrderType.LIMIT,
        client_order_id="bad",
    )
    with pytest.raises(BrokerRejectedError):
        await adapter.place_order(acc, req)


@pytest.mark.unit
async def test_mock_requires_connect() -> None:
    adapter = MockBrokerAdapter()
    with pytest.raises(BrokerAuthError):
        await adapter.list_accounts()


@pytest.mark.unit
async def test_mock_unknown_account() -> None:
    adapter = MockBrokerAdapter()
    await adapter.connect({})
    with pytest.raises(BrokerNotFoundError):
        await adapter.get_positions("nope")


@pytest.mark.unit
async def test_mock_fail_auth_config() -> None:
    adapter = MockBrokerAdapter()
    with pytest.raises(BrokerAuthError, match="Mock auth"):
        await adapter.connect({"fail_auth": True})


@pytest.mark.unit
async def test_mock_place_order_hard_blocks_when_pdt_limit_reached() -> None:
    adapter = MockBrokerAdapter()
    enforcer = AccountPDTEnforcer(
        account_states={
            "MOCK-1": PDTUserState(
                user_id="u1",
                day_trade_dates=(date(2026, 4, 23), date(2026, 4, 24), date(2026, 4, 27)),
                pdt_exempt=False,
            )
        },
        as_of=date(2026, 4, 28),
    )
    await adapter.connect({"pdt_enforcer": enforcer})
    acc = (await adapter.list_accounts())[0].account_id
    req = PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=1,
        order_type=OrderType.MARKET,
        client_order_id="pdt-block",
    )
    with pytest.raises(BrokerRejectedError, match="PDT hard block"):
        await adapter.place_order(acc, req)
