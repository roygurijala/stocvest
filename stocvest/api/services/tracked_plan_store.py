"""Tracked trade plan persistence (DynamoDB in non-dev)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from stocvest.signals.tracked_trade_plan import MAX_TRACKED_PLANS_PER_USER, TrackedTradePlan
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


class TrackedPlanStore(Protocol):
    def list_plans(self, user_id: str) -> tuple[TrackedTradePlan, ...]: ...
    def replace_all(self, user_id: str, plans: tuple[TrackedTradePlan, ...]) -> None: ...
    def upsert_plan(self, plan: TrackedTradePlan) -> None: ...
    def remove_plan(self, user_id: str, plan_id: str) -> bool: ...


def _plan_sort_key(plan: TrackedTradePlan) -> float:
    return plan.committed_at.timestamp()


def _dedupe_plans(plans: tuple[TrackedTradePlan, ...]) -> tuple[TrackedTradePlan, ...]:
    """One plan per symbol+mode — newest commit wins."""
    by_key: dict[str, TrackedTradePlan] = {}
    for p in plans:
        key = f"{p.mode}:{p.symbol}"
        cur = by_key.get(key)
        if cur is None or _plan_sort_key(p) >= _plan_sort_key(cur):
            by_key[key] = p
    ordered = sorted(by_key.values(), key=_plan_sort_key, reverse=True)
    return tuple(ordered[:MAX_TRACKED_PLANS_PER_USER])


@dataclass
class InMemoryTrackedPlanStore:
    _by_user: dict[str, tuple[TrackedTradePlan, ...]]

    def list_plans(self, user_id: str) -> tuple[TrackedTradePlan, ...]:
        return self._by_user.get(user_id, ())

    def replace_all(self, user_id: str, plans: tuple[TrackedTradePlan, ...]) -> None:
        self._by_user[user_id] = _dedupe_plans(plans)

    def upsert_plan(self, plan: TrackedTradePlan) -> None:
        rest = tuple(p for p in self.list_plans(plan.user_id) if p.plan_id != plan.plan_id)
        merged = _dedupe_plans(rest + (plan,))
        self._by_user[plan.user_id] = merged

    def remove_plan(self, user_id: str, plan_id: str) -> bool:
        cur = self.list_plans(user_id)
        nxt = tuple(p for p in cur if p.plan_id != plan_id)
        if len(nxt) == len(cur):
            return False
        self._by_user[user_id] = nxt
        return True


@dataclass
class DynamoDBTrackedPlanStore:
    table: DynamoTableLike
    user_key: str = "userId"
    plans_key: str = "plans"

    @classmethod
    def from_boto3_table(
        cls,
        *,
        table_name: str,
        dynamodb_resource: Any = None,
    ) -> DynamoDBTrackedPlanStore:
        if dynamodb_resource is None:
            import boto3

            endpoint_url = get_settings().dynamodb_endpoint_url
            dynamodb_resource = (
                boto3.resource("dynamodb", endpoint_url=endpoint_url)
                if endpoint_url
                else boto3.resource("dynamodb")
            )
        table = dynamodb_resource.Table(table_name)
        return cls(table=table)

    def list_plans(self, user_id: str) -> tuple[TrackedTradePlan, ...]:
        resp = self.table.get_item(Key={self.user_key: user_id})
        item = resp.get("Item")
        if not item:
            return ()
        rows = item.get(self.plans_key) or []
        plans = [
            TrackedTradePlan.from_dynamo_item(user_id=user_id, item=x)
            for x in rows
            if isinstance(x, dict)
        ]
        return _dedupe_plans(tuple(plans))

    def replace_all(self, user_id: str, plans: tuple[TrackedTradePlan, ...]) -> None:
        deduped = _dedupe_plans(plans)
        self.table.put_item(
            Item={
                self.user_key: user_id,
                self.plans_key: [p.to_dynamo_item() for p in deduped],
            }
        )

    def upsert_plan(self, plan: TrackedTradePlan) -> None:
        cur = self.list_plans(plan.user_id)
        rest = tuple(p for p in cur if p.plan_id != plan.plan_id)
        self.replace_all(plan.user_id, rest + (plan,))

    def remove_plan(self, user_id: str, plan_id: str) -> bool:
        cur = self.list_plans(user_id)
        nxt = tuple(p for p in cur if p.plan_id != plan_id)
        if len(nxt) == len(cur):
            return False
        self.replace_all(user_id, nxt)
        return True


def build_default_tracked_plan_store() -> TrackedPlanStore:
    settings = get_settings()
    if settings.trade_plans_table:
        return DynamoDBTrackedPlanStore.from_boto3_table(table_name=settings.trade_plans_table)
    if settings.is_development:
        return InMemoryTrackedPlanStore(_by_user={})
    raise ValueError(
        "STOCVEST_TRADE_PLANS_TABLE must be configured in non-development environments."
    )


_TRACKED_PLAN_STORE: TrackedPlanStore | None = None


def get_tracked_plan_store() -> TrackedPlanStore:
    # Lazy init so importing this module never builds boto3/settings at cold start, and
    # so a missing table in non-dev fails on first use (not at import of every Lambda).
    global _TRACKED_PLAN_STORE
    if _TRACKED_PLAN_STORE is None:
        _TRACKED_PLAN_STORE = build_default_tracked_plan_store()
    return _TRACKED_PLAN_STORE


def reset_tracked_plan_store_for_tests() -> None:
    global _TRACKED_PLAN_STORE
    _TRACKED_PLAN_STORE = None
