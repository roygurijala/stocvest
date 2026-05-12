"""DynamoDB rows for SignalParameters version history.

D10 Phase 4 extension: previously this module only exposed a write API
(:func:`put_parameter_history_version`, called from
:meth:`ParameterStore.save_parameters_sync`). The rollback workflow needs
to **read** prior rows so the admin can pick a target and the rollback
orchestrator can reconstruct the full ``SignalParameters`` payload from
the audit row.

Two new APIs:

* :func:`list_parameter_history_versions` — returns rows newest-first,
  optionally capped. Used by the rollback picker UI.
* :func:`get_parameter_history_version` — returns a single row by
  version. Used by the rollback orchestrator to reconstruct the
  ``SignalParameters`` payload before calling ``save_parameters_sync``.

Both reads are best-effort: when the table is not configured (the env
var is empty) they return empty/``None`` rather than raising, so a
misconfigured dev/test environment never breaks the admin surface — it
just shows an empty history list.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Defensive guardrail — `ParameterHistory` should be small (one row per
# promotion; rotations are admin-gated and infrequent). Scanning more
# than this is a sign of either a runaway optimizer or a table outage
# we want to surface in CloudWatch, not silently absorb.
_MAX_HISTORY_SCAN_ROWS = 500


@dataclass(frozen=True)
class ParameterHistoryRow:
    """One row from the ``ParameterHistory`` table.

    ``parameters_json`` is the raw JSON string that was written to
    Secrets Manager at the time of the rotation. Pass it to
    :func:`stocvest.config.parameter_store.signal_parameters_from_dict`
    via ``json.loads`` to reconstruct a :class:`SignalParameters` for
    rollback.

    ``signal_count_on_change`` and ``accuracy_before_change`` are
    best-effort metadata supplied by the caller of
    ``ParameterStore.save_parameters_sync`` — they may be 0 / 0.0 for
    older rows that were written before the field was populated.
    """

    version: str
    created_at: str
    reason: str
    parameters_json: str
    signal_count_on_change: int = 0
    accuracy_before_change: float = 0.0
    changed_by: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "created_at": self.created_at,
            "reason": self.reason,
            "parameters_json": self.parameters_json,
            "signal_count_on_change": int(self.signal_count_on_change),
            "accuracy_before_change": float(self.accuracy_before_change),
            "changed_by": self.changed_by,
        }


def _resolve_table() -> Any | None:
    """Build a boto3 Table resource for `ParameterHistory`; ``None`` if unconfigured."""
    settings = get_settings()
    name = (settings.dynamodb_parameter_history_table or "").strip()
    if not name:
        return None
    kwargs: dict[str, Any] = {}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    try:
        dynamodb = boto3.resource("dynamodb", region_name=settings.aws_region, **kwargs)
        return dynamodb.Table(name)
    except Exception as exc:  # pragma: no cover — boto3 surface
        _LOG.warning("parameter history resource build failed: %s", exc)
        return None


def _coerce_row(item: dict[str, Any]) -> ParameterHistoryRow | None:
    """Coerce a raw DDB item into a :class:`ParameterHistoryRow`.

    Returns ``None`` for items missing the mandatory ``version`` /
    ``parameters`` fields so a corrupted or partially-written row cannot
    crash the list view.
    """
    if not isinstance(item, dict):
        return None
    version = item.get("version")
    parameters_json = item.get("parameters")
    if not isinstance(version, str) or not version.strip():
        return None
    if not isinstance(parameters_json, str):
        # ``parameters`` is always a JSON string per the writer contract.
        # A non-string here means the row was written by a different
        # writer (or DDB Decimal coercion went sideways) — skip it.
        return None
    try:
        signal_count = int(item.get("signal_count_on_change") or 0)
    except (TypeError, ValueError):
        signal_count = 0
    try:
        accuracy = float(item.get("accuracy_before_change") or 0.0)
    except (TypeError, ValueError):
        accuracy = 0.0
    return ParameterHistoryRow(
        version=version,
        created_at=str(item.get("created_at") or ""),
        reason=str(item.get("reason") or ""),
        parameters_json=parameters_json,
        signal_count_on_change=signal_count,
        accuracy_before_change=accuracy,
        changed_by=str(item.get("changed_by") or ""),
    )


def put_parameter_history_version(
    *,
    version: str,
    created_at: str,
    reason: str,
    parameters_json: str,
    signal_count_on_change: int | None,
    accuracy_before_change: float | None,
    changed_by: str = "stocvest-admin",
) -> None:
    """Best-effort write; logs and returns if table not configured or AWS errors."""
    settings = get_settings()
    name = (settings.dynamodb_parameter_history_table or "").strip()
    if not name:
        _LOG.debug("parameter history skipped: DYNAMODB_PARAMETER_HISTORY_TABLE unset")
        return
    item: dict[str, Any] = {
        "version": version,
        "created_at": created_at,
        "reason": reason,
        "parameters": parameters_json,
        "signal_count_on_change": int(signal_count_on_change or 0),
        "accuracy_before_change": float(accuracy_before_change or 0.0),
        "changed_by": changed_by,
    }
    try:
        kwargs: dict[str, Any] = {}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", region_name=settings.aws_region, **kwargs)
        dynamodb.Table(name).put_item(Item=item)
    except ClientError as exc:
        _LOG.warning("parameter history put failed: %s", exc)


def list_parameter_history_versions(
    *,
    limit: int = 50,
    table: Any | None = None,
) -> list[ParameterHistoryRow]:
    """List rows from ``ParameterHistory``, newest-first.

    ``ParameterHistory`` rows are written one per rotation (no churn),
    so a full scan is cheap at the table sizes we expect. The result is
    sorted in Python by ``created_at`` descending — DDB does not
    natively sort scans, but the row count is tiny.

    Returns ``[]`` when the table is unconfigured or the scan fails, so
    a transient AWS error never blocks the admin UI from rendering.
    """
    if limit <= 0:
        return []
    tbl = table if table is not None else _resolve_table()
    if tbl is None:
        return []
    try:
        # Scan with a hard upper bound; we'll trim to ``limit`` after sort.
        kwargs: dict[str, Any] = {"Limit": min(_MAX_HISTORY_SCAN_ROWS, limit * 4 or 1)}
        rows: list[ParameterHistoryRow] = []
        last_key: dict[str, Any] | None = None
        while True:
            if last_key is not None:
                kwargs["ExclusiveStartKey"] = last_key
            resp = tbl.scan(**kwargs)
            for raw in resp.get("Items") or []:
                row = _coerce_row(raw)
                if row is not None:
                    rows.append(row)
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
            if len(rows) >= _MAX_HISTORY_SCAN_ROWS:
                break
        rows.sort(key=lambda r: r.created_at, reverse=True)
        return rows[: max(0, int(limit))]
    except ClientError as exc:
        _LOG.warning("parameter history scan failed: %s", exc)
        return []
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.warning("parameter history scan unexpected error: %s", exc)
        return []


def get_parameter_history_version(
    version: str,
    *,
    table: Any | None = None,
) -> ParameterHistoryRow | None:
    """Fetch one ``ParameterHistory`` row by version, or ``None`` if missing."""
    if not isinstance(version, str) or not version.strip():
        return None
    tbl = table if table is not None else _resolve_table()
    if tbl is None:
        return None
    try:
        resp = tbl.get_item(Key={"version": version.strip()})
    except ClientError as exc:
        _LOG.warning("parameter history get failed for %r: %s", version, exc)
        return None
    item = resp.get("Item") if isinstance(resp, dict) else None
    if not isinstance(item, dict):
        return None
    return _coerce_row(item)


def parameters_dict_from_history_row(row: ParameterHistoryRow) -> dict[str, Any] | None:
    """Decode ``row.parameters_json`` into a dict; ``None`` on parse failure.

    Pure helper extracted so the rollback orchestrator and the list-view
    handler don't both reimplement the same defensive parse.
    """
    try:
        parsed = json.loads(row.parameters_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed
