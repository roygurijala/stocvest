"""Cross-instance persistence for the weekly Position scan snapshot — ADR-004 POS-D15.

The weekly batch (one Lambda invocation) scans the expanded universe and persists a single
snapshot blob; every other Lambda instance (invest page / candidates API / assistant gem
discovery) reads that blob so the gem list is warm without recomputing.

Two implementations behind a tiny :class:`PositionScanStore` protocol:
  * :class:`InMemoryPositionScanStore` — default; process-local (used in tests and as a safe
    no-persistence fallback).
  * :class:`DynamoPositionScanStore` — active only when ``STOCVEST_POSITION_SCAN_TABLE`` is set;
    stores the JSON blob on a single fixed key. Any boto/parse failure degrades to ``None``.

The factory returns the Dynamo store when a table is configured, else the in-memory store, so
callers never branch on environment.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from stocvest.api.services.position_scan import PositionScanSnapshot
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Single fixed partition key — there is exactly one current platform-wide snapshot.
_SNAPSHOT_KEY = "position_scan_snapshot_v1"


class PositionScanStore(Protocol):
    def get(self) -> PositionScanSnapshot | None: ...
    def put(self, snapshot: PositionScanSnapshot) -> bool: ...


class InMemoryPositionScanStore:
    """Process-local store — the safe default when no table is configured."""

    def __init__(self) -> None:
        self._snapshot: PositionScanSnapshot | None = None

    def get(self) -> PositionScanSnapshot | None:
        return self._snapshot

    def put(self, snapshot: PositionScanSnapshot) -> bool:
        self._snapshot = snapshot
        return True


class DynamoPositionScanStore:
    """DynamoDB-backed snapshot blob (one item). Best-effort; failures degrade to ``None``/False."""

    def __init__(self, table_name: str) -> None:
        self._table_name = table_name
        self._table: Any = None

    def _get_table(self) -> Any:
        if self._table is None:
            import boto3

            self._table = boto3.resource("dynamodb").Table(self._table_name)
        return self._table

    def get(self) -> PositionScanSnapshot | None:
        try:
            resp = self._get_table().get_item(Key={"snapshot_key": _SNAPSHOT_KEY})
        except Exception as exc:  # noqa: BLE001 — read is best-effort
            _LOG.warning("position scan store get failed: %s", type(exc).__name__)
            return None
        item = resp.get("Item") if isinstance(resp, dict) else None
        if not isinstance(item, dict):
            return None
        raw = item.get("blob")
        if not raw:
            return None
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except (ValueError, TypeError):
            return None
        if not isinstance(data, dict):
            return None
        snap = PositionScanSnapshot.from_store_dict(data)
        return snap if snap.candidates else None

    def put(self, snapshot: PositionScanSnapshot) -> bool:
        try:
            blob = json.dumps(snapshot.to_store_dict(), separators=(",", ":"))
            self._get_table().put_item(
                Item={"snapshot_key": _SNAPSHOT_KEY, "blob": blob}
            )
            return True
        except Exception as exc:  # noqa: BLE001 — persistence is best-effort
            _LOG.warning("position scan store put failed: %s", type(exc).__name__)
            return False


_store: PositionScanStore | None = None


def get_position_scan_store() -> PositionScanStore:
    """Return the process singleton store (Dynamo when configured, else in-memory)."""
    global _store
    if _store is None:
        table = str(getattr(get_settings(), "stocvest_position_scan_table", "") or "").strip()
        _store = DynamoPositionScanStore(table) if table else InMemoryPositionScanStore()
    return _store


def reset_position_scan_store_for_tests(store: PositionScanStore | None = None) -> None:
    global _store
    _store = store
