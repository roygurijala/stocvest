"""Audit event persistence (DynamoDB + in-memory fallback)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from stocvest.data.models import AuditEvent
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def query(self, **kwargs: Any) -> dict[str, Any]: ...
    def scan(self, **kwargs: Any) -> dict[str, Any]: ...


class AuditStore(Protocol):
    def put_event(self, event: AuditEvent) -> None: ...
    def get_user_events(self, user_id: str, *, limit: int = 200) -> list[AuditEvent]: ...
    def get_session_events(self, session_id: str, *, limit: int = 200) -> list[AuditEvent]: ...
    def list_recent_events(
        self,
        *,
        limit: int = 100,
        module: str | None = None,
        route_prefix: str | None = None,
    ) -> list[AuditEvent]: ...


#: Defensive guardrail on the global feed Scan. ``AuditEvents`` is keyed by
#: ``pk=user#<id>`` (one partition per user), so a global "give me the
#: newest N events" view inevitably costs a Scan. Capping the upper bound
#: lets us bill predictably while still surfacing the latest admin actions
#: — the page UI only renders a hundred or so at a time and the operator
#: can filter by ``module`` / ``route_prefix`` when looking further back.
_MAX_RECENT_SCAN_LIMIT = 1000


def _event_to_item(event: AuditEvent) -> dict[str, Any]:
    user_key = event.user_id or "anon"
    return {
        "pk": f"user#{user_key}",
        "sk": f"{event.occurred_at.isoformat()}#{event.event_id}",
        "eventId": event.event_id,
        "occurredAt": event.occurred_at.isoformat(),
        "module": event.module,
        "route": event.route,
        "method": event.method,
        "path": event.path,
        "requestId": event.request_id,
        "sessionId": event.session_id,
        "userId": event.user_id,
        "statusCode": event.status_code,
        "outcome": event.outcome,
        "entitlementSnapshot": event.entitlement_snapshot,
        "pricingSnapshot": event.pricing_snapshot,
        "requestSummary": event.request_summary,
        "responseSummary": event.response_summary,
        "marketSnapshot": event.market_snapshot,
    }


def _item_to_event(item: dict[str, Any]) -> AuditEvent:
    raw_at = str(item.get("occurredAt") or "")
    try:
        ts = datetime.fromisoformat(raw_at.replace("Z", "+00:00"))
    except ValueError:
        ts = datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return AuditEvent(
        event_id=str(item.get("eventId") or ""),
        occurred_at=ts,
        module=str(item.get("module") or ""),
        route=str(item.get("route") or ""),
        method=str(item.get("method") or ""),
        path=str(item.get("path") or ""),
        request_id=str(item.get("requestId") or "") or None,
        session_id=str(item.get("sessionId") or "") or None,
        user_id=str(item.get("userId") or "") or None,
        status_code=int(item.get("statusCode") or 0),
        outcome=str(item.get("outcome") or "unknown"),
        entitlement_snapshot=dict(item.get("entitlementSnapshot") or {}),
        pricing_snapshot=dict(item.get("pricingSnapshot") or {}),
        request_summary=dict(item.get("requestSummary") or {}),
        response_summary=dict(item.get("responseSummary") or {}),
        market_snapshot=dict(item.get("marketSnapshot") or {}),
    )


@dataclass
class InMemoryAuditStore:
    _events: list[AuditEvent] = field(default_factory=list)

    def put_event(self, event: AuditEvent) -> None:
        self._events.append(event)

    def get_user_events(self, user_id: str, *, limit: int = 200) -> list[AuditEvent]:
        rows = [e for e in self._events if e.user_id == user_id]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)
        return rows[: max(1, limit)]

    def get_session_events(self, session_id: str, *, limit: int = 200) -> list[AuditEvent]:
        rows = [e for e in self._events if e.session_id == session_id]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)
        return rows[: max(1, limit)]

    def list_recent_events(
        self,
        *,
        limit: int = 100,
        module: str | None = None,
        route_prefix: str | None = None,
    ) -> list[AuditEvent]:
        rows = list(self._events)
        if module:
            rows = [e for e in rows if e.module == module]
        if route_prefix:
            rows = [e for e in rows if e.route.startswith(route_prefix)]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)
        return rows[: max(1, limit)]


@dataclass
class DynamoAuditStore:
    table: DynamoTableLike

    @classmethod
    def from_boto3_table(cls, *, table_name: str, dynamodb_resource: Any = None) -> "DynamoAuditStore":
        if dynamodb_resource is None:
            import boto3

            dynamodb_resource = boto3.resource("dynamodb")
        return cls(table=dynamodb_resource.Table(table_name))

    def put_event(self, event: AuditEvent) -> None:
        self.table.put_item(Item=_event_to_item(event))

    def get_user_events(self, user_id: str, *, limit: int = 200) -> list[AuditEvent]:
        # Table designed with pk/sk for user timeline.
        resp = self.table.query(
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": f"user#{user_id}"},
            ScanIndexForward=False,
            Limit=max(1, limit),
        )
        return [_item_to_event(it) for it in (resp.get("Items") or [])]

    def get_session_events(self, session_id: str, *, limit: int = 200) -> list[AuditEvent]:
        # Fallback scan when no session GSI is provisioned yet.
        resp = self.table.scan(
            FilterExpression="sessionId = :sid",
            ExpressionAttributeValues={":sid": session_id},
            Limit=max(1, min(1000, limit)),
        )
        rows = [_item_to_event(it) for it in (resp.get("Items") or [])]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)
        return rows[: max(1, limit)]

    def list_recent_events(
        self,
        *,
        limit: int = 100,
        module: str | None = None,
        route_prefix: str | None = None,
    ) -> list[AuditEvent]:
        """Return the newest events across **every** user partition.

        The table has no time-ordered GSI today (pk is per-user), so a
        bounded ``Scan`` is the only honest option. The ``_MAX_RECENT_SCAN_LIMIT``
        ceiling keeps a single call cheap; the page UI is wired to
        ``limit`` (default 100) and never asks for more than 500.

        ``module`` / ``route_prefix`` are server-side ``FilterExpression``
        clauses so a busy table doesn't have to hand the client thousands
        of rows it will discard. The result is sorted in Python by
        ``occurred_at`` descending because Scan output ordering is
        undefined.
        """
        capped = max(1, min(_MAX_RECENT_SCAN_LIMIT, int(limit)))
        kwargs: dict[str, Any] = {"Limit": capped}
        filter_parts: list[str] = []
        attr_names: dict[str, str] = {}
        attr_values: dict[str, Any] = {}
        if module:
            filter_parts.append("#m = :module")
            attr_names["#m"] = "module"
            attr_values[":module"] = str(module).strip()
        if route_prefix:
            filter_parts.append("begins_with(#r, :route_prefix)")
            attr_names["#r"] = "route"
            attr_values[":route_prefix"] = str(route_prefix).strip()
        if filter_parts:
            kwargs["FilterExpression"] = " AND ".join(filter_parts)
            kwargs["ExpressionAttributeNames"] = attr_names
            kwargs["ExpressionAttributeValues"] = attr_values
        resp = self.table.scan(**kwargs)
        rows = [_item_to_event(it) for it in (resp.get("Items") or [])]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)
        return rows[: max(1, int(limit))]


def build_default_audit_store() -> AuditStore:
    s = get_settings()
    if s.dynamodb_audit_events_table:
        return DynamoAuditStore.from_boto3_table(table_name=s.dynamodb_audit_events_table)
    return InMemoryAuditStore()


_AUDIT_STORE: AuditStore | None = None


def get_audit_store() -> AuditStore:
    global _AUDIT_STORE
    if _AUDIT_STORE is None:
        _AUDIT_STORE = build_default_audit_store()
    return _AUDIT_STORE


def reset_audit_store_for_tests() -> None:
    global _AUDIT_STORE
    _AUDIT_STORE = None
