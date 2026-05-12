"""Lock-in tests for :meth:`AuditStore.list_recent_events`.

The global newest-first feed powers the admin hub audit page. The DDB
implementation uses a bounded ``Scan`` because the table is keyed by
user partition with no time-ordered GSI — these tests pin that contract:

* Cap on ``Limit`` so an admin curl with ``?limit=99999`` cannot drain
  the table.
* ``module`` / ``route_prefix`` translate into server-side
  ``FilterExpression`` clauses.
* In-memory sort is descending by ``occurred_at`` so Scan's undefined
  output order doesn't leak.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from stocvest.api.services.audit_store import (
    DynamoAuditStore,
    InMemoryAuditStore,
)
from stocvest.data.models import AuditEvent


def _ev(
    *,
    user_id: str = "u",
    occurred_at: str = "2026-05-01T00:00:00+00:00",
    module: str = "signals",
    route: str = "GET /v1/signals/recent",
    status_code: int = 200,
) -> AuditEvent:
    return AuditEvent(
        event_id=f"ev-{occurred_at}",
        occurred_at=datetime.fromisoformat(occurred_at),
        module=module,
        route=route,
        method="GET",
        path=route.split(" ", 1)[1] if " " in route else route,
        status_code=status_code,
        outcome="success",
    )


# ── InMemoryAuditStore ──────────────────────────────────────────────────


def test_inmemory_recent_returns_newest_first() -> None:
    store = InMemoryAuditStore()
    store.put_event(_ev(occurred_at="2026-05-01T00:00:00+00:00"))
    store.put_event(_ev(occurred_at="2026-05-03T00:00:00+00:00"))
    store.put_event(_ev(occurred_at="2026-05-02T00:00:00+00:00"))
    rows = store.list_recent_events(limit=10)
    assert [r.occurred_at.isoformat() for r in rows] == [
        "2026-05-03T00:00:00+00:00",
        "2026-05-02T00:00:00+00:00",
        "2026-05-01T00:00:00+00:00",
    ]


def test_inmemory_recent_honours_limit() -> None:
    store = InMemoryAuditStore()
    for i in range(5):
        store.put_event(_ev(occurred_at=f"2026-05-{i + 1:02d}T00:00:00+00:00"))
    rows = store.list_recent_events(limit=2)
    assert len(rows) == 2
    assert rows[0].occurred_at.isoformat() == "2026-05-05T00:00:00+00:00"


def test_inmemory_recent_filters_by_module() -> None:
    store = InMemoryAuditStore()
    store.put_event(_ev(module="signals"))
    store.put_event(_ev(module="brokers"))
    store.put_event(_ev(module="signals", occurred_at="2026-05-02T00:00:00+00:00"))
    rows = store.list_recent_events(limit=10, module="signals")
    assert len(rows) == 2
    assert all(r.module == "signals" for r in rows)


def test_inmemory_recent_filters_by_route_prefix() -> None:
    store = InMemoryAuditStore()
    store.put_event(_ev(route="GET /v1/admin/proposals"))
    store.put_event(_ev(route="GET /v1/signals/recent"))
    store.put_event(_ev(route="POST /v1/admin/parameters/rollback"))
    rows = store.list_recent_events(limit=10, route_prefix="/v1/admin")
    # route_prefix matches against the full route descriptor incl. method,
    # so prefix "/v1/admin" alone does NOT match any of these. Test with
    # a method-prefixed value too.
    assert rows == []

    rows2 = store.list_recent_events(limit=10, route_prefix="GET /v1/admin")
    assert len(rows2) == 1
    assert rows2[0].route == "GET /v1/admin/proposals"


# ── DynamoAuditStore — verified against a fake table that records the call ─


class _FakeTable:
    """Records the kwargs passed to ``scan`` so tests can assert on them."""

    def __init__(self, *, items: list[dict[str, Any]] | None = None) -> None:
        self.items = items or []
        self.scan_kwargs: dict[str, Any] | None = None

    def scan(self, **kwargs: Any) -> dict[str, Any]:
        self.scan_kwargs = dict(kwargs)
        return {"Items": list(self.items)}


def _item(occurred_at: str, *, module: str = "signals", route: str = "GET /x") -> dict[str, Any]:
    return {
        "eventId": f"ev-{occurred_at}",
        "occurredAt": occurred_at,
        "module": module,
        "route": route,
        "method": "GET",
        "path": "/x",
        "statusCode": 200,
        "outcome": "success",
    }


def test_dynamo_recent_caps_limit_at_internal_max() -> None:
    """``limit=99999`` is clamped to the internal max (1000) before
    leaving for DDB so a runaway request cannot drain the table."""
    tbl = _FakeTable()
    store = DynamoAuditStore(table=tbl)
    store.list_recent_events(limit=99_999)
    assert tbl.scan_kwargs is not None
    assert tbl.scan_kwargs["Limit"] == 1000


def test_dynamo_recent_no_filter_expression_when_no_filters() -> None:
    tbl = _FakeTable(items=[_item("2026-05-01T00:00:00+00:00")])
    store = DynamoAuditStore(table=tbl)
    rows = store.list_recent_events(limit=10)
    assert tbl.scan_kwargs is not None
    assert "FilterExpression" not in tbl.scan_kwargs
    assert len(rows) == 1


def test_dynamo_recent_module_filter_attaches_filter_expression() -> None:
    tbl = _FakeTable(items=[_item("2026-05-01T00:00:00+00:00", module="signals")])
    store = DynamoAuditStore(table=tbl)
    store.list_recent_events(limit=10, module="signals")
    assert tbl.scan_kwargs is not None
    assert "FilterExpression" in tbl.scan_kwargs
    assert tbl.scan_kwargs["ExpressionAttributeValues"][":module"] == "signals"
    assert tbl.scan_kwargs["ExpressionAttributeNames"]["#m"] == "module"


def test_dynamo_recent_route_prefix_uses_begins_with() -> None:
    tbl = _FakeTable(items=[_item("2026-05-01T00:00:00+00:00")])
    store = DynamoAuditStore(table=tbl)
    store.list_recent_events(limit=10, route_prefix="GET /v1/admin")
    assert tbl.scan_kwargs is not None
    assert "begins_with" in tbl.scan_kwargs["FilterExpression"]
    assert tbl.scan_kwargs["ExpressionAttributeValues"][":route_prefix"] == "GET /v1/admin"


def test_dynamo_recent_combines_filters_with_and() -> None:
    tbl = _FakeTable()
    store = DynamoAuditStore(table=tbl)
    store.list_recent_events(limit=10, module="signals", route_prefix="GET /v1/admin")
    assert tbl.scan_kwargs is not None
    assert " AND " in tbl.scan_kwargs["FilterExpression"]


def test_dynamo_recent_sorts_descending_after_scan() -> None:
    """DDB Scan output ordering is undefined; the store sorts in Python."""
    tbl = _FakeTable(
        items=[
            _item("2026-05-01T00:00:00+00:00"),
            _item("2026-05-03T00:00:00+00:00"),
            _item("2026-05-02T00:00:00+00:00"),
        ]
    )
    store = DynamoAuditStore(table=tbl)
    rows = store.list_recent_events(limit=10)
    assert [r.occurred_at.isoformat() for r in rows] == [
        "2026-05-03T00:00:00+00:00",
        "2026-05-02T00:00:00+00:00",
        "2026-05-01T00:00:00+00:00",
    ]
