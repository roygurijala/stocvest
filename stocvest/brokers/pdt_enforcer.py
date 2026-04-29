"""Broker-layer PDT enforcement helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

from stocvest.brokers.exceptions import BrokerRejectedError
from stocvest.brokers.models import PlaceOrderRequest
from stocvest.signals.pdt_tracker import PDTTracker, PDTUserState


@dataclass
class AccountPDTEnforcer:
    """
    Hard block pre-submit hook for accounts subject to PDT rules.

    `account_states` can be loaded from Dynamo-backed user/account records.
    """

    account_states: dict[str, PDTUserState]
    as_of: date | None = None
    tracker: PDTTracker = PDTTracker()

    async def assert_can_place_order(self, account_id: str, request: PlaceOrderRequest) -> None:
        _ = request  # hook runs before any order submission, irrespective of order shape.
        state = self.account_states.get(account_id)
        if state is None:
            return
        assessment = self.tracker.assess(state, as_of=self.as_of or date.today())
        if not assessment.allow_next_day_trade:
            raise BrokerRejectedError(
                "PDT hard block: account at 3 day trades in rolling 5-day window and not exempt."
            )


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class DynamoDBAccountPDTEnforcer:
    """
    DynamoDB-backed PDT enforcer.

    Expected item shape by default:
    {
      "accountId": "...",
      "userId": "...",
      "dayTradeDates": ["YYYY-MM-DD", ...],
      "pdtExempt": false
    }
    """

    table: DynamoTableLike
    as_of: date | None = None
    tracker: PDTTracker = PDTTracker()
    account_key: str = "accountId"
    user_key: str = "userId"
    day_trade_dates_key: str = "dayTradeDates"
    pdt_exempt_key: str = "pdtExempt"

    @classmethod
    def from_boto3_table(
        cls,
        *,
        table_name: str,
        dynamodb_resource: Any = None,
        as_of: date | None = None,
        account_key: str = "accountId",
        user_key: str = "userId",
        day_trade_dates_key: str = "dayTradeDates",
        pdt_exempt_key: str = "pdtExempt",
    ) -> "DynamoDBAccountPDTEnforcer":
        if dynamodb_resource is None:
            import boto3

            dynamodb_resource = boto3.resource("dynamodb")
        table = dynamodb_resource.Table(table_name)
        return cls(
            table=table,
            as_of=as_of,
            account_key=account_key,
            user_key=user_key,
            day_trade_dates_key=day_trade_dates_key,
            pdt_exempt_key=pdt_exempt_key,
        )

    async def assert_can_place_order(self, account_id: str, request: PlaceOrderRequest) -> None:
        _ = request
        state = self._load_state_for_account(account_id)
        if state is None:
            return
        assessment = self.tracker.assess(state, as_of=self.as_of or date.today())
        if not assessment.allow_next_day_trade:
            raise BrokerRejectedError(
                "PDT hard block: account at 3 day trades in rolling 5-day window and not exempt."
            )

    def _load_state_for_account(self, account_id: str) -> PDTUserState | None:
        resp = self.table.get_item(Key={self.account_key: account_id})
        item = resp.get("Item")
        if not item:
            return None
        raw_dates = item.get(self.day_trade_dates_key) or []
        user_id = str(item.get(self.user_key) or account_id)
        return PDTUserState(
            user_id=user_id,
            day_trade_dates=tuple(date.fromisoformat(str(x)) for x in raw_dates),
            pdt_exempt=bool(item.get(self.pdt_exempt_key, False)),
        )

