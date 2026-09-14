"""Cross-instance persistence for the Position scan snapshot — ADR-004 POS-D15.

One stable Dynamo item holds the last successful list. Engine/gate revisions live
inside the blob (``PositionScanSnapshot.engine_version``), not in the key. Bumping
the key to cache-bust (v1 → v2) orphaned Invest when the next compose failed.

On read, a leftover v1/v2 item is copied onto the stable key once (migration),
then ignored. Writes always go to the stable key. Refresh must overwrite on
success — never delete the last list first.
"""

from __future__ import annotations

import json
import time
from typing import Any, Protocol

from stocvest.api.services.position_scan import PositionScanSnapshot
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_SNAPSHOT_KEY = "position_scan_snapshot"
_LOCK_KEY = "position_scan_refresh_lock"
# Pre-stable keys. Read-only hydrate, then rewrite onto ``_SNAPSHOT_KEY``.
_MIGRATION_KEYS: tuple[str, ...] = (
    "position_scan_snapshot_v2",
    "position_scan_snapshot_v1",
)


class PositionScanStore(Protocol):
    def get(self) -> PositionScanSnapshot | None: ...
    def put(self, snapshot: PositionScanSnapshot) -> bool: ...
    def invalidate(self) -> bool: ...
    def try_claim_refresh(self, *, stale_after_seconds: int = 180) -> bool: ...


def invalidate_position_scan_snapshot() -> bool:
    """Drop the in-process cache. Tests / ops only — refresh must not delete Dynamo."""
    from stocvest.api.services.position_scan import clear_position_scan_snapshot_cache

    clear_position_scan_snapshot_cache()
    try:
        return get_position_scan_store().invalidate()
    except Exception:  # noqa: BLE001 — invalidate is best-effort
        return False


def try_claim_position_scan_refresh(*, stale_after_seconds: int = 180) -> bool:
    """True if this caller should start a universe compose (no fresh lock)."""
    try:
        return get_position_scan_store().try_claim_refresh(stale_after_seconds=stale_after_seconds)
    except Exception:  # noqa: BLE001 — claim is best-effort; skip a duplicate kick
        return False


class InMemoryPositionScanStore:
    """Process-local store — the safe default when no table is configured."""

    def __init__(self) -> None:
        self._snapshot: PositionScanSnapshot | None = None
        self._claimed_at: float = 0.0

    def get(self) -> PositionScanSnapshot | None:
        return self._snapshot

    def put(self, snapshot: PositionScanSnapshot) -> bool:
        self._snapshot = snapshot
        return True

    def invalidate(self) -> bool:
        self._snapshot = None
        return True

    def try_claim_refresh(self, *, stale_after_seconds: int = 180) -> bool:
        now = time.time()
        if self._claimed_at and (now - self._claimed_at) < max(0, stale_after_seconds):
            return False
        self._claimed_at = now
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
        snap = self._get_key(_SNAPSHOT_KEY)
        if snap is not None:
            return snap
        for key in _MIGRATION_KEYS:
            snap = self._get_key(key)
            if snap is None:
                continue
            self.put(snap)
            return snap
        return None

    def _get_key(self, key: str) -> PositionScanSnapshot | None:
        try:
            resp = self._get_table().get_item(Key={"snapshot_key": key})
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

    def invalidate(self) -> bool:
        try:
            self._get_table().delete_item(Key={"snapshot_key": _SNAPSHOT_KEY})
            return True
        except Exception as exc:  # noqa: BLE001 — invalidate is best-effort
            _LOG.warning("position scan store invalidate failed: %s", type(exc).__name__)
            return False

    def try_claim_refresh(self, *, stale_after_seconds: int = 180) -> bool:
        now = time.time()
        cutoff = now - max(0, stale_after_seconds)
        try:
            from decimal import Decimal

            self._get_table().put_item(
                Item={"snapshot_key": _LOCK_KEY, "claimed_at": Decimal(str(now))},
                ConditionExpression="attribute_not_exists(snapshot_key) OR claimed_at < :cutoff",
                ExpressionAttributeValues={":cutoff": Decimal(str(cutoff))},
            )
            return True
        except Exception as exc:  # noqa: BLE001 — a failed claim must not stampede
            code = ""
            resp = getattr(exc, "response", None)
            if isinstance(resp, dict):
                code = str((resp.get("Error") or {}).get("Code") or "")
            if code == "ConditionalCheckFailedException" or "ConditionalCheckFailed" in type(exc).__name__:
                return False
            _LOG.warning("position scan store claim failed: %s", type(exc).__name__)
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
