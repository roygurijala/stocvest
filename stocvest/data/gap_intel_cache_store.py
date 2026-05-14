"""Read-through DynamoDB cache for gap-intel snapshots (symbol × mode × ET session date).

When ``DYNAMODB_GAP_INTEL_CACHE_TABLE`` is unset or empty, all functions no-op / return
``None`` so local tests and cold environments behave like a pure Polygon recompute path.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def gap_intel_cache_key(symbol: str, trading_mode: str, session_date_et: str) -> str:
    u = symbol.strip().upper()
    m = trading_mode.strip().lower()
    return f"{u}#{m}#{session_date_et}"


@dataclass(frozen=True)
class GapIntelCacheRow:
    payload: dict[str, Any]
    soft_expire: int
    last_sb_state: str | None
    last_disable_metric_at: int | None


def _table_name() -> str:
    return (get_settings().dynamodb_gap_intel_cache_table or "").strip()


def get_gap_intel_cache_row(cache_key: str) -> GapIntelCacheRow | None:
    name = _table_name()
    if not name:
        return None
    try:
        resp = boto3.client("dynamodb").get_item(
            TableName=name, Key={"cacheKey": {"S": cache_key}}, ConsistentRead=False
        )
    except ClientError as exc:
        _LOG.warning("gap_intel_cache get_item failed: %s", exc)
        return None
    item = resp.get("Item") or {}
    if not item:
        return None
    try:
        raw = item["payload"]["S"]
        payload = json.loads(raw)
        soft = int(item["softExpire"]["N"])
        last_sb = item.get("lastSbState", {}).get("S")
        ldm = item.get("lastDisableMetricAt", {}).get("N")
        last_disable = int(ldm) if ldm else None
        if not isinstance(payload, dict):
            return None
        return GapIntelCacheRow(
            payload=payload,
            soft_expire=soft,
            last_sb_state=last_sb,
            last_disable_metric_at=last_disable,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        _LOG.warning("gap_intel_cache corrupt row %s: %s", cache_key, exc)
        return None


def put_gap_intel_cache_row(
    cache_key: str,
    payload: dict[str, Any],
    *,
    soft_ttl_seconds: int = 120,
    last_disable_metric_at: int | None = None,
) -> None:
    name = _table_name()
    if not name:
        return
    now = int(time.time())
    soft = now + max(30, int(soft_ttl_seconds))
    ttl = now + 86400 * 3
    sb = payload.get("scenario_builder") if isinstance(payload.get("scenario_builder"), dict) else {}
    last_sb = str(sb.get("state") or "") or None
    item: dict[str, Any] = {
        "cacheKey": {"S": cache_key},
        "payload": {"S": json.dumps(payload, separators=(",", ":"), default=str)},
        "softExpire": {"N": str(soft)},
        "ttl": {"N": str(ttl)},
    }
    if last_sb:
        item["lastSbState"] = {"S": last_sb}
    if last_disable_metric_at is not None:
        item["lastDisableMetricAt"] = {"N": str(last_disable_metric_at)}
    try:
        boto3.client("dynamodb").put_item(TableName=name, Item=item)
    except ClientError as exc:
        _LOG.warning("gap_intel_cache put_item failed: %s", exc)
