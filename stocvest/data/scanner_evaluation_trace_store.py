"""Per-user scanner evaluation trace (B33) — DynamoDB with 48h TTL."""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)
_ET = ZoneInfo("America/New_York")
_TRACE_TTL_SECONDS = 48 * 3600
_SK_PREFIX = "trace#"


def session_date_et(now: datetime | None = None) -> str:
    dt = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_ET).date().isoformat()


def trace_sort_key(desk: str, session_date: str) -> str:
    d = desk.strip().lower()
    if d not in ("day", "swing"):
        raise ValueError(f"desk must be day or swing, got {desk!r}")
    return f"{_SK_PREFIX}{d}#{session_date.strip()}"


def _table_name() -> str:
    return (get_settings().dynamodb_scanner_evaluation_trace_table or "").strip()


def put_scanner_evaluation_trace(
    user_id: str,
    desk: str,
    rows: list[dict[str, Any]],
    *,
    session_date: str | None = None,
    scanned_at_iso: str | None = None,
) -> None:
    """Upsert trace rows for user × desk × ET session date."""
    uid = user_id.strip()
    if not uid or not rows:
        return
    name = _table_name()
    if not name:
        return
    sess = session_date or session_date_et()
    sk = trace_sort_key(desk, sess)
    now = int(time.time())
    item: dict[str, Any] = {
        "userId": {"S": uid},
        "sk": {"S": sk},
        "desk": {"S": desk.strip().lower()},
        "sessionDateEt": {"S": sess},
        "evaluationTrace": {"S": json.dumps(rows, separators=(",", ":"), default=str)},
        "scannedAtIso": {"S": scanned_at_iso or datetime.now(timezone.utc).isoformat()},
        "updatedAt": {"N": str(now)},
        "ttl": {"N": str(now + _TRACE_TTL_SECONDS)},
    }
    try:
        boto3.client("dynamodb").put_item(TableName=name, Item=item)
    except ClientError as exc:
        _LOG.warning("scanner_evaluation_trace put_item failed user=%s sk=%s: %s", uid, sk, exc)


def get_scanner_evaluation_trace(
    user_id: str,
    desk: str,
    *,
    session_date: str | None = None,
) -> dict[str, Any] | None:
    """Return stored trace document or ``None``."""
    uid = user_id.strip()
    if not uid:
        return None
    name = _table_name()
    if not name:
        return None
    sess = session_date or session_date_et()
    sk = trace_sort_key(desk, sess)
    try:
        resp = boto3.client("dynamodb").get_item(
            TableName=name,
            Key={"userId": {"S": uid}, "sk": {"S": sk}},
            ConsistentRead=False,
        )
    except ClientError as exc:
        _LOG.warning("scanner_evaluation_trace get_item failed: %s", exc)
        return None
    item = resp.get("Item") or {}
    if not item:
        return None
    try:
        raw = item["evaluationTrace"]["S"]
        trace = json.loads(raw)
        if not isinstance(trace, list):
            return None
        return {
            "desk": item.get("desk", {}).get("S", desk),
            "session_date_et": item.get("sessionDateEt", {}).get("S", sess),
            "scanned_at_iso": item.get("scannedAtIso", {}).get("S"),
            "evaluation_trace": trace,
        }
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        _LOG.warning("scanner_evaluation_trace corrupt row %s: %s", sk, exc)
        return None


def get_scanner_evaluation_traces_merged(
    user_id: str,
    *,
    mode: str = "both",
    session_date: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Load day and/or swing traces for the session, merged up to ``limit``."""
    m = mode.strip().lower()
    desks: list[str]
    if m == "day":
        desks = ["day"]
    elif m == "swing":
        desks = ["swing"]
    else:
        desks = ["day", "swing"]
    merged: list[dict[str, Any]] = []
    for desk in desks:
        doc = get_scanner_evaluation_trace(user_id, desk, session_date=session_date)
        if not doc:
            continue
        block = doc.get("evaluation_trace")
        if isinstance(block, list):
            merged.extend([r for r in block if isinstance(r, dict)])
        if len(merged) >= limit:
            break
    return merged[: max(0, limit)]
