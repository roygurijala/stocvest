"""Print the Cognito `sub` for a user whose pool username is the given email.

Pools that sign up with `Username: email` use the email as the Cognito username.

Requires: COGNITO_USER_POOL_ID, COGNITO_REGION (or AWS_REGION), AWS credentials with cognito-idp:AdminGetUser.

Usage:
  python scripts/cognito_sub_for_email.py --email you@example.com
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import boto3
from dotenv import load_dotenv

from stocvest.utils.config import get_settings


def main() -> None:
    _root = Path(__file__).resolve().parents[1]
    load_dotenv(_root / ".env")
    load_dotenv(_root / "frontend" / ".env.local")

    p = argparse.ArgumentParser(description="Resolve Cognito sub from email-shaped username.")
    p.add_argument("--email", required=True, help="Same value the user types at login (usually lowercased by Cognito).")
    args = p.parse_args()
    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip() or (os.environ.get("NEXT_PUBLIC_COGNITO_USER_POOL_ID") or "").strip()
    if not pool:
        raise SystemExit(
            "Cognito pool id missing. Set COGNITO_USER_POOL_ID or NEXT_PUBLIC_COGNITO_USER_POOL_ID (e.g. from frontend/.env.local)."
        )
    region = (settings.cognito_region or settings.aws_region or "us-east-1").strip()
    email = str(args.email).strip().lower()
    if not email:
        raise SystemExit("--email is required.")
    client = boto3.client("cognito-idp", region_name=region)
    resp = client.admin_get_user(UserPoolId=pool, Username=email)
    sub = next((a["Value"] for a in resp.get("UserAttributes", []) if a.get("Name") == "sub"), None)
    if not sub:
        raise SystemExit("No sub attribute on user (unexpected).")
    print(sub)


if __name__ == "__main__":
    main()
