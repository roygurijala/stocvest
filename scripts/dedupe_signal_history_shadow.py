"""Remove duplicate shadow rows from SignalHistory (Lambda retry artifacts).

When the combined ledger_capture job timed out, EventBridge/async retries re-ran
the day loop and wrote the same shadow row 2–3 times per (user, symbol, mode, day).
This script keeps the earliest row per group and deletes the rest.

Never touches qualified, live, or non-shadow rows.

Usage (from repo root, with AWS credentials):

  # Preview deletions:
  python scripts/dedupe_signal_history_shadow.py --dry-run

  # Execute (requires confirmation env):
  set STOCVEST_CONFIRM_DEDUPE_SIGNAL_HISTORY=yes
  python scripts/dedupe_signal_history_shadow.py --execute
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import boto3

_SHADOW_SUFFIX = ":ledger_capture_shadow"
_ET = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class ShadowRow:
    signal_id: str
    user_id: str
    symbol: str
    mode: str
    session_date_et: str
    generated_at: datetime


def is_shadow_row(item: dict[str, Any]) -> bool:
    ck = str(item.get("capture_kind") or "").strip().lower()
    pat = str(item.get("pattern") or "")
    if ck == "shadow":
        return True
    return _SHADOW_SUFFIX in pat


def _parse_generated_at(raw: Any) -> datetime | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=ZoneInfo("UTC"))
    text = str(raw).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt


def shadow_dedupe_key(row: ShadowRow) -> tuple[str, str, str, str]:
    return (row.session_date_et, row.user_id, row.symbol.upper(), row.mode)


def select_shadow_duplicates_to_delete(rows: list[ShadowRow]) -> list[str]:
    """Return signal_ids to delete — keep earliest generated_at per dedupe key."""
    buckets: dict[tuple[str, str, str, str], list[ShadowRow]] = defaultdict(list)
    for row in rows:
        buckets[shadow_dedupe_key(row)].append(row)
    to_delete: list[str] = []
    for group in buckets.values():
        if len(group) <= 1:
            continue
        group.sort(key=lambda r: r.generated_at)
        to_delete.extend(r.signal_id for r in group[1:])
    return to_delete


def _resolve_table(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    kwargs: dict[str, Any] = {}
    if args.region:
        kwargs["region_name"] = args.region
    if args.table:
        endpoint = os.environ.get("DYNAMODB_ENDPOINT_URL", "").strip()
        if endpoint.startswith("http"):
            kwargs["endpoint_url"] = endpoint
        return args.table.strip(), kwargs
    try:
        from stocvest.utils.config import get_settings

        settings = get_settings()
        name = settings.dynamodb_signal_history_table.strip()
        endpoint = (settings.dynamodb_endpoint_url or "").strip()
        if endpoint.startswith("http"):
            kwargs["endpoint_url"] = endpoint
        if not kwargs.get("region_name"):
            kwargs["region_name"] = settings.aws_region
        if name:
            return name, kwargs
    except Exception as exc:
        sys.stderr.write(f"[info] could not load app settings ({exc}); falling back to env.\n")
    name = os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "SignalHistory").strip()
    endpoint = os.environ.get("DYNAMODB_ENDPOINT_URL", "").strip()
    if endpoint.startswith("http"):
        kwargs["endpoint_url"] = endpoint
    if not kwargs.get("region_name"):
        kwargs["region_name"] = os.environ.get("AWS_REGION", "us-east-1")
    return name, kwargs


def load_shadow_rows(table) -> list[ShadowRow]:
    rows: list[ShadowRow] = []
    scan_kwargs: dict[str, Any] = {
        "ProjectionExpression": "signal_id, user_id, symbol, #m, pattern, capture_kind, generated_at",
        "ExpressionAttributeNames": {"#m": "mode"},
    }
    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items") or []:
            if not is_shadow_row(item):
                continue
            gen_at = _parse_generated_at(item.get("generated_at"))
            if gen_at is None:
                continue
            sid = str(item.get("signal_id") or "").strip()
            if not sid:
                continue
            session_date = gen_at.astimezone(_ET).date().isoformat()
            rows.append(
                ShadowRow(
                    signal_id=sid,
                    user_id=str(item.get("user_id") or ""),
                    symbol=str(item.get("symbol") or ""),
                    mode=str(item.get("mode") or "unknown"),
                    session_date_et=session_date,
                    generated_at=gen_at,
                )
            )
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    return rows


def delete_rows(table, signal_ids: list[str], *, batch_size: int = 25) -> int:
    deleted = 0
    for i in range(0, len(signal_ids), batch_size):
        chunk = signal_ids[i : i + batch_size]
        with table.batch_writer() as batch:
            for sid in chunk:
                batch.delete_item(Key={"signal_id": sid})
                deleted += 1
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser(description="Dedupe shadow SignalHistory rows from retry artifacts.")
    ap.add_argument("--table", default="", help="DynamoDB table name (default: from settings/env).")
    ap.add_argument("--region", default="", help="AWS region.")
    ap.add_argument("--dry-run", action="store_true", help="Report duplicates without deleting.")
    ap.add_argument("--execute", action="store_true", help="Delete duplicate shadow rows.")
    args = ap.parse_args()
    if args.dry_run == args.execute:
        ap.error("Specify exactly one of --dry-run or --execute")

    if args.execute and os.environ.get("STOCVEST_CONFIRM_DEDUPE_SIGNAL_HISTORY") != "yes":
        sys.stderr.write(
            "Refusing to delete: set STOCVEST_CONFIRM_DEDUPE_SIGNAL_HISTORY=yes to confirm.\n"
        )
        return 1

    table_name, boto_kwargs = _resolve_table(args)
    table = boto3.resource("dynamodb", **boto_kwargs).Table(table_name)

    shadow_rows = load_shadow_rows(table)
    to_delete = select_shadow_duplicates_to_delete(shadow_rows)
    buckets: dict[tuple[str, str, str, str], int] = defaultdict(int)
    for r in shadow_rows:
        buckets[shadow_dedupe_key(r)] += 1
    dup_groups = sum(1 for c in buckets.values() if c > 1)

    print(f"Table              : {table_name}")
    print(f"Shadow rows scanned: {len(shadow_rows)}")
    print(f"Duplicate groups   : {dup_groups}")
    print(f"Rows to delete     : {len(to_delete)}")
    print(f"Rows to keep       : {len(shadow_rows) - len(to_delete)}")

    if args.dry_run:
        print("\n[dry-run] No rows deleted.")
        return 0

    if not to_delete:
        print("\nNothing to delete.")
        return 0

    deleted = delete_rows(table, to_delete)
    print(f"\nDeleted {deleted} duplicate shadow rows from {table_name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
