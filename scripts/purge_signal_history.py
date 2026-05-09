"""Delete every item in the configured DynamoDB SignalHistory table.

Requires env STOCVEST_CONFIRM_PURGE_SIGNAL_HISTORY=yes. Use only in dev/staging or
when intentionally resetting the ledger after rule changes.

Usage (from repo root, with AWS credentials and table env set):
  set STOCVEST_CONFIRM_PURGE_SIGNAL_HISTORY=yes
  python scripts/purge_signal_history.py
"""

from __future__ import annotations

import os
import sys

import boto3

from stocvest.utils.config import get_settings


def main() -> int:
    if os.environ.get("STOCVEST_CONFIRM_PURGE_SIGNAL_HISTORY") != "yes":
        sys.stderr.write(
            "Refusing to run: set STOCVEST_CONFIRM_PURGE_SIGNAL_HISTORY=yes to confirm full table delete.\n"
        )
        return 1
    settings = get_settings()
    name = settings.dynamodb_signal_history_table.strip()
    if not name:
        sys.stderr.write("DYNAMODB_SIGNAL_HISTORY_TABLE is not set.\n")
        return 1
    kwargs: dict[str, str] = {}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    dynamodb = boto3.resource("dynamodb", **kwargs)
    table = dynamodb.Table(name)
    deleted = 0
    scan_kwargs: dict[str, object] = {"ProjectionExpression": "signal_id"}
    while True:
        resp = table.scan(**scan_kwargs)
        items = resp.get("Items") or []
        with table.batch_writer() as batch:
            for it in items:
                sid = it.get("signal_id")
                if sid:
                    batch.delete_item(Key={"signal_id": sid})
                    deleted += 1
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    print(f"Deleted {deleted} items from {name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
