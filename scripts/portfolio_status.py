#!/usr/bin/env python3
"""CLI snapshot of model portfolio summary + open positions (reads DynamoDB ModelPortfolio)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import boto3  # noqa: E402


def main() -> None:
    table_name = os.environ.get("DYNAMODB_MODEL_PORTFOLIO_TABLE", "ModelPortfolio")
    region = os.environ.get("AWS_REGION", "us-east-1")
    dynamo = boto3.resource("dynamodb", region_name=region)
    table = dynamo.Table(table_name)

    summary = table.get_item(Key={"pk": "PORTFOLIO#v1", "sk": "SUMMARY"}).get("Item") or {}

    print("\n" + "=" * 50)
    print("STOCVEST MODEL PORTFOLIO")
    print("=" * 50)

    if summary:
        total_ret = float(summary.get("total_return_dollars") or 0)
        win_rate = float(summary.get("win_rate") or 0)
        print(f"Total return: ${total_ret:+,.2f}")
        print(f"Win rate: {win_rate:.1%}")
        print(f"Closed positions: {summary.get('closed_positions', 0)}")
    else:
        print("No summary row yet — no closed positions recorded.")

    open_resp = table.query(
        IndexName="status-entry-index",
        KeyConditionExpression="#s = :open",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":open": "open"},
    )
    open_pos = open_resp.get("Items") or []

    print(f"\nOPEN POSITIONS ({len(open_pos)}/10)")
    print("-" * 50)

    for pos in open_pos:
        symbol = pos.get("symbol", "?")
        entry = float(pos.get("entry_price") or 0)
        score = pos.get("signal_score", "?")
        stop = float(pos.get("stop_loss_price") or 0)
        target = float(pos.get("target_price") or 0)
        entry_date = str(pos.get("entry_date", ""))[:10]
        print(
            f"{str(symbol):6} Entry:${entry:.2f} Signal:{score}% "
            f"Stop:${stop:.2f} Target:${target:.2f} Since:{entry_date}"
        )

    print("=" * 50)


if __name__ == "__main__":
    main()
