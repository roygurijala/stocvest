from __future__ import annotations

from datetime import date

import pytest

from stocvest.brokers import AccountPDTEnforcer, DynamoDBAccountPDTEnforcer
from stocvest.brokers.exceptions import BrokerRejectedError
from stocvest.brokers.models import OrderSide, OrderType, PlaceOrderRequest
from stocvest.signals.pdt_tracker import PDTUserState


@pytest.mark.unit
async def test_account_pdt_enforcer_blocks_non_exempt_at_limit() -> None:
    enforcer = AccountPDTEnforcer(
        account_states={
            "A1": PDTUserState(
                user_id="u1",
                day_trade_dates=(date(2026, 4, 23), date(2026, 4, 24), date(2026, 4, 27)),
                pdt_exempt=False,
            )
        },
        as_of=date(2026, 4, 28),
    )
    req = PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        client_order_id="x1",
    )
    with pytest.raises(BrokerRejectedError, match="PDT hard block"):
        await enforcer.assert_can_place_order("A1", req)


@pytest.mark.unit
async def test_account_pdt_enforcer_allows_exempt_or_missing_account() -> None:
    enforcer = AccountPDTEnforcer(
        account_states={
            "A2": PDTUserState(
                user_id="u2",
                day_trade_dates=(date(2026, 4, 23), date(2026, 4, 24), date(2026, 4, 27)),
                pdt_exempt=True,
            )
        },
        as_of=date(2026, 4, 28),
    )
    req = PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        client_order_id="x2",
    )
    await enforcer.assert_can_place_order("A2", req)
    await enforcer.assert_can_place_order("UNKNOWN", req)


class FakeDynamoTable:
    def __init__(self, items_by_account: dict[str, dict]):
        self._items_by_account = items_by_account

    def get_item(self, *, Key: dict) -> dict:
        account_id = Key["accountId"]
        item = self._items_by_account.get(account_id)
        return {"Item": item} if item else {}


@pytest.mark.unit
async def test_dynamodb_enforcer_blocks_non_exempt_at_limit() -> None:
    enforcer = DynamoDBAccountPDTEnforcer(
        table=FakeDynamoTable(
            {
                "A1": {
                    "accountId": "A1",
                    "userId": "u1",
                    "dayTradeDates": ["2026-04-23", "2026-04-24", "2026-04-27"],
                    "pdtExempt": False,
                }
            }
        ),
        as_of=date(2026, 4, 28),
    )
    req = PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        client_order_id="x3",
    )
    with pytest.raises(BrokerRejectedError, match="PDT hard block"):
        await enforcer.assert_can_place_order("A1", req)


@pytest.mark.unit
async def test_dynamodb_enforcer_allows_missing_or_exempt() -> None:
    enforcer = DynamoDBAccountPDTEnforcer(
        table=FakeDynamoTable(
            {
                "A2": {
                    "accountId": "A2",
                    "userId": "u2",
                    "dayTradeDates": ["2026-04-23", "2026-04-24", "2026-04-27"],
                    "pdtExempt": True,
                }
            }
        ),
        as_of=date(2026, 4, 28),
    )
    req = PlaceOrderRequest(
        symbol="AAPL",
        side=OrderSide.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        client_order_id="x4",
    )
    await enforcer.assert_can_place_order("A2", req)
    await enforcer.assert_can_place_order("UNKNOWN", req)


@pytest.mark.unit
def test_dynamodb_enforcer_from_boto3_table_helper() -> None:
    table = FakeDynamoTable({})

    class FakeResource:
        def Table(self, name: str):
            assert name == "DayTradingSetups"
            return table

    enforcer = DynamoDBAccountPDTEnforcer.from_boto3_table(
        table_name="DayTradingSetups",
        dynamodb_resource=FakeResource(),
    )
    assert isinstance(enforcer, DynamoDBAccountPDTEnforcer)

