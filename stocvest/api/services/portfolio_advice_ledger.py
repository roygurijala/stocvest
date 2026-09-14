"""Persistence + outcome resolve for the portfolio advice ledger."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Protocol

from stocvest.models.portfolio_advice_ledger import (
    KIND_REVIEW,
    PortfolioLedgerEvent,
    ledger_summary,
    review_events_from_payload,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

PriceAfterFn = Callable[[str, date], float | None]


class DynamoTableLike(Protocol):
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def query(self, **kwargs: Any) -> dict[str, Any]: ...


class PortfolioAdviceLedgerStore(Protocol):
    def append(self, event: PortfolioLedgerEvent) -> None: ...
    def list_events(self, user_id: str) -> tuple[PortfolioLedgerEvent, ...]: ...
    def put_event(self, event: PortfolioLedgerEvent) -> None: ...


@dataclass
class InMemoryPortfolioAdviceLedgerStore:
    _by_user: dict[str, list[PortfolioLedgerEvent]] = field(default_factory=dict)

    def append(self, event: PortfolioLedgerEvent) -> None:
        self._by_user.setdefault(event.user_id, []).append(event)

    def list_events(self, user_id: str) -> tuple[PortfolioLedgerEvent, ...]:
        rows = list(self._by_user.get(user_id, ()))
        rows.sort(key=lambda e: (e.occurred_at, e.event_id))
        return tuple(rows)

    def put_event(self, event: PortfolioLedgerEvent) -> None:
        cur = self._by_user.setdefault(event.user_id, [])
        nxt: list[PortfolioLedgerEvent] = []
        replaced = False
        for existing in cur:
            if existing.event_id == event.event_id:
                nxt.append(event)
                replaced = True
            else:
                nxt.append(existing)
        if not replaced:
            nxt.append(event)
        self._by_user[event.user_id] = nxt


@dataclass
class DynamoDBPortfolioAdviceLedgerStore:
    table: DynamoTableLike
    user_key: str = "userId"
    event_key: str = "eventId"

    @classmethod
    def from_boto3_table(
        cls, *, table_name: str, dynamodb_resource: Any = None
    ) -> DynamoDBPortfolioAdviceLedgerStore:
        if dynamodb_resource is None:
            import boto3

            endpoint_url = get_settings().dynamodb_endpoint_url
            dynamodb_resource = (
                boto3.resource("dynamodb", endpoint_url=endpoint_url)
                if endpoint_url
                else boto3.resource("dynamodb")
            )
        return cls(table=dynamodb_resource.Table(table_name))

    def append(self, event: PortfolioLedgerEvent) -> None:
        self.table.put_item(Item=event.to_dynamo_item())

    def put_event(self, event: PortfolioLedgerEvent) -> None:
        self.append(event)

    def list_events(self, user_id: str) -> tuple[PortfolioLedgerEvent, ...]:
        from boto3.dynamodb.conditions import Key

        rows: list[PortfolioLedgerEvent] = []
        last_key: dict[str, Any] | None = None
        while True:
            kwargs: dict[str, Any] = {
                "KeyConditionExpression": Key(self.user_key).eq(user_id)
            }
            if last_key:
                kwargs["ExclusiveStartKey"] = last_key
            resp = self.table.query(**kwargs)
            for item in resp.get("Items") or []:
                if not isinstance(item, dict):
                    continue
                try:
                    rows.append(PortfolioLedgerEvent.from_item(item))
                except (TypeError, ValueError):
                    continue
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
        rows.sort(key=lambda e: (e.occurred_at, e.event_id))
        return tuple(rows)


def build_default_portfolio_advice_ledger_store() -> PortfolioAdviceLedgerStore:
    settings = get_settings()
    table = getattr(settings, "portfolio_advice_ledger_table", "") or ""
    if table:
        return DynamoDBPortfolioAdviceLedgerStore.from_boto3_table(table_name=table)
    if settings.is_development:
        return InMemoryPortfolioAdviceLedgerStore()
    raise ValueError(
        "STOCVEST_PORTFOLIO_ADVICE_LEDGER_TABLE must be configured in non-development."
    )


_STORE: PortfolioAdviceLedgerStore | None = None


def get_portfolio_advice_ledger_store() -> PortfolioAdviceLedgerStore:
    global _STORE
    if _STORE is None:
        _STORE = build_default_portfolio_advice_ledger_store()
    return _STORE


def reset_portfolio_advice_ledger_store_for_tests(
    store: PortfolioAdviceLedgerStore | None = None,
) -> None:
    global _STORE
    _STORE = store if store is not None else InMemoryPortfolioAdviceLedgerStore()


def record_review_snapshots(
    user_id: str,
    review: dict[str, Any],
    cached_at: str,
    *,
    source: str | None = None,
    store: PortfolioAdviceLedgerStore | None = None,
) -> int:
    """Append per-holding review events; skip same-day duplicate action+source."""
    ledger = store or get_portfolio_advice_ledger_store()
    existing = ledger.list_events(user_id)
    events = review_events_from_payload(
        user_id=user_id,
        review=review,
        cached_at=cached_at,
        source=source,
        existing=existing,
    )
    for event in events:
        ledger.append(event)
    return len(events)


def _horizon_due(occurred_at: str, *, days: int, today: date) -> bool:
    start = date.fromisoformat(occurred_at[:10])
    return today >= start + timedelta(days=days)


def due_horizons(event: PortfolioLedgerEvent, *, today: date) -> list[int]:
    due: list[int] = []
    if event.resolved_30d_at is None and _horizon_due(event.occurred_at, days=30, today=today):
        due.append(30)
    if event.resolved_90d_at is None and _horizon_due(event.occurred_at, days=90, today=today):
        due.append(90)
    return due


def resolve_due_outcomes(
    user_id: str,
    *,
    store: PortfolioAdviceLedgerStore | None = None,
    price_fn: PriceAfterFn | None = None,
    today: date | None = None,
    limit: int = 20,
) -> int:
    """Fill 30d/90d closes for events whose horizon has elapsed. Never logs prices."""
    ledger = store or get_portfolio_advice_ledger_store()
    as_of = today or datetime.now(timezone.utc).date()
    getter = price_fn or close_on_or_after
    resolved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    filled = 0
    for event in ledger.list_events(user_id):
        if event.kind == KIND_REVIEW and (event.advice_action or "") == "review":
            continue
        horizons = due_horizons(event, today=as_of)
        if not horizons:
            continue
        updated = event
        for horizon in horizons:
            start = date.fromisoformat(event.occurred_at[:10])
            target = start + timedelta(days=horizon)
            try:
                price = getter(event.symbol, target)
            except Exception as exc:  # noqa: BLE001 — resolve is best-effort
                _LOG.warning("portfolio_advice_ledger price lookup failed: %s", exc)
                price = None
            updated = updated.with_outcome(
                horizon=horizon, price_after=price, resolved_at=resolved_at
            )
        if updated is not event:
            ledger.put_event(updated)
            filled += 1
            if filled >= limit:
                break
    return filled


def close_on_or_after(symbol: str, target: date) -> float | None:
    """Daily close on or after ``target`` (first bar in a +7d window)."""
    import asyncio

    from stocvest.data.models import Timeframe
    from stocvest.data.polygon_client import PolygonClient

    async def _fetch() -> float | None:
        client = PolygonClient()
        bars = await client.get_bars(
            symbol,
            Timeframe.DAY_1,
            from_date=target,
            to_date=target + timedelta(days=7),
            limit=15,
        )
        if not bars:
            return None
        return float(bars[0].close)

    return asyncio.run(_fetch())


def ledger_to_api(
    user_id: str,
    *,
    store: PortfolioAdviceLedgerStore | None = None,
    resolve: bool = False,
    price_fn: PriceAfterFn | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    ledger = store or get_portfolio_advice_ledger_store()
    if resolve:
        try:
            resolve_due_outcomes(
                user_id, store=ledger, price_fn=price_fn, today=today
            )
        except Exception as exc:  # noqa: BLE001 — listing must not 500
            _LOG.warning("portfolio_advice_ledger resolve skipped: %s", exc)
    events = ledger.list_events(user_id)
    return {
        "events": [e.to_api() for e in events],
        "count": len(events),
        "summary": ledger_summary(events),
    }
