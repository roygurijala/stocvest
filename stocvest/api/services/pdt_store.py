"""PDT state store for API handlers (DynamoDB-backed in non-dev)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

from stocvest.signals.pdt_tracker import PDTUserState
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


class PDTStateStore(Protocol):
    def get_state(self, user_id: str) -> PDTUserState: ...
    def save_state(self, state: PDTUserState) -> None: ...
    def record_day_trade(self, user_id: str, trade_date: date) -> PDTUserState: ...


@dataclass
class InMemoryPDTStateStore:
    _states: dict[str, PDTUserState]

    def get_state(self, user_id: str) -> PDTUserState:
        return self._states.get(
            user_id,
            PDTUserState(user_id=user_id, day_trade_dates=(), pdt_exempt=False),
        )

    def save_state(self, state: PDTUserState) -> None:
        self._states[state.user_id] = state

    def record_day_trade(self, user_id: str, trade_date: date) -> PDTUserState:
        state = self.get_state(user_id)
        updated = PDTUserState(
            user_id=state.user_id,
            day_trade_dates=state.day_trade_dates + (trade_date,),
            pdt_exempt=state.pdt_exempt,
        )
        self.save_state(updated)
        return updated


@dataclass
class DynamoDBPDTStateStore:
    table: DynamoTableLike
    user_key: str = "userId"
    dates_key: str = "dayTradeDates"
    exempt_key: str = "pdtExempt"

    @classmethod
    def from_boto3_table(
        cls,
        *,
        table_name: str,
        dynamodb_resource: Any = None,
        user_key: str = "userId",
        dates_key: str = "dayTradeDates",
        exempt_key: str = "pdtExempt",
    ) -> "DynamoDBPDTStateStore":
        if dynamodb_resource is None:
            import boto3

            dynamodb_resource = boto3.resource("dynamodb")
        table = dynamodb_resource.Table(table_name)
        return cls(
            table=table,
            user_key=user_key,
            dates_key=dates_key,
            exempt_key=exempt_key,
        )

    def get_state(self, user_id: str) -> PDTUserState:
        resp = self.table.get_item(Key={self.user_key: user_id})
        item = resp.get("Item")
        if not item:
            return PDTUserState(user_id=user_id, day_trade_dates=(), pdt_exempt=False)
        raw_dates = item.get(self.dates_key) or []
        return PDTUserState(
            user_id=str(item.get(self.user_key, user_id)),
            day_trade_dates=tuple(date.fromisoformat(str(x)) for x in raw_dates),
            pdt_exempt=bool(item.get(self.exempt_key, False)),
        )

    def save_state(self, state: PDTUserState) -> None:
        self.table.put_item(
            Item={
                self.user_key: state.user_id,
                self.dates_key: [d.isoformat() for d in state.day_trade_dates],
                self.exempt_key: state.pdt_exempt,
            }
        )

    def record_day_trade(self, user_id: str, trade_date: date) -> PDTUserState:
        state = self.get_state(user_id)
        updated = PDTUserState(
            user_id=state.user_id,
            day_trade_dates=state.day_trade_dates + (trade_date,),
            pdt_exempt=state.pdt_exempt,
        )
        self.save_state(updated)
        return updated


def build_default_pdt_state_store() -> PDTStateStore:
    settings = get_settings()
    if settings.pdt_state_table:
        return DynamoDBPDTStateStore.from_boto3_table(table_name=settings.pdt_state_table)
    if settings.is_development:
        return InMemoryPDTStateStore(_states={})
    raise ValueError("STOCVEST_PDT_STATE_TABLE must be configured in non-development environments.")


_PDT_STATE_STORE: PDTStateStore = build_default_pdt_state_store()


def get_pdt_state_store() -> PDTStateStore:
    return _PDT_STATE_STORE
