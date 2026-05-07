"""Grant/revoke full beta access for specific users.

Usage examples:
  python scripts/beta_access.py --user-id <cognito-sub> --enable
  python scripts/beta_access.py --user-id <cognito-sub> --enable --until 2026-12-31T23:59:59+00:00
  python scripts/beta_access.py --user-id <cognito-sub> --disable
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from typing import Any

import boto3

from stocvest.utils.config import get_settings


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Toggle STOCVEST beta full access for a user.")
    p.add_argument("--user-id", required=True, help="Target user id (Cognito sub / Users.userId).")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--enable", action="store_true", help="Enable beta full access.")
    mode.add_argument("--disable", action="store_true", help="Disable beta full access.")
    p.add_argument("--until", default="", help="Optional ISO timestamp for beta expiry when enabling.")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    settings = get_settings()
    table_name = (settings.dynamodb_users_table or "").strip()
    if not table_name:
        raise SystemExit("DYNAMODB_USERS_TABLE is required.")
    ddb = boto3.resource("dynamodb", region_name=settings.aws_region)
    table = ddb.Table(table_name)
    user_id = str(args.user_id).strip()
    if not user_id:
        raise SystemExit("--user-id is required.")
    existing = table.get_item(Key={"userId": user_id}).get("Item") or {"userId": user_id}
    enabled = bool(args.enable)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated: dict[str, Any] = {
        **existing,
        "betaFullAccess": enabled,
        "betaAccessUntil": args.until.strip() if enabled and args.until.strip() else None,
        "betaAccessGrantedAt": now_iso if enabled else None,
    }
    # DynamoDB low-level serializer prefers absent keys over explicit None.
    if updated.get("betaAccessUntil") is None:
        updated.pop("betaAccessUntil", None)
    if updated.get("betaAccessGrantedAt") is None:
        updated.pop("betaAccessGrantedAt", None)
    table.put_item(Item=updated)
    print(
        json.dumps(
            {
                "user_id": user_id,
                "beta_full_access": enabled,
                "beta_access_until": updated.get("betaAccessUntil"),
                "beta_access_granted_at": updated.get("betaAccessGrantedAt"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
