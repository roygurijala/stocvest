"""Grant or revoke STOCVEST admin (``signal-analytics-admin``) membership.

This is the **bootstrap path** for the admin hub — once at least one
user is in the ``signal-analytics-admin`` Cognito group, subsequent
grants can happen entirely from the UI at
``/dashboard/admin/users`` (Grant admin / Revoke admin buttons).
Without this script you would be locked out of the very surface that
manages admin membership.

The script is intentionally permissive about *how* you identify the
target user:

* ``--email`` resolves the Cognito username via ``AdminGetUser`` and
  is the easiest path for humans (pools that sign up with email use
  the email as both Username and the ``email`` attribute).
* ``--user-id`` accepts the Cognito sub directly — handy when you
  already have it from another script or DynamoDB.

Required environment (loaded from ``.env`` and ``frontend/.env.local``):

* ``COGNITO_USER_POOL_ID`` (or ``NEXT_PUBLIC_COGNITO_USER_POOL_ID``)
* ``COGNITO_REGION`` (or ``AWS_REGION``)
* AWS credentials with the following permissions scoped to the pool:
    - ``cognito-idp:AdminGetUser``
    - ``cognito-idp:AdminAddUserToGroup``
    - ``cognito-idp:AdminRemoveUserFromGroup``
    - ``cognito-idp:AdminListGroupsForUser``

Usage::

    # Grant by email (most common bootstrap)
    python scripts/grant_admin.py --email you@example.com --grant

    # Grant by sub
    python scripts/grant_admin.py --user-id <cognito-sub> --grant

    # Revoke
    python scripts/grant_admin.py --email someone@example.com --revoke

    # Inspect without mutating (lists current groups)
    python scripts/grant_admin.py --email you@example.com --list
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

from stocvest.utils.config import get_settings


ADMIN_GROUP_NAME = "signal-analytics-admin"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Toggle STOCVEST admin (signal-analytics-admin) Cognito-group "
            "membership for a user. Bootstrap path for the admin hub."
        )
    )
    target = p.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--email",
        help="Email-shaped Cognito username (pools with email as username).",
    )
    target.add_argument(
        "--user-id",
        help="Cognito sub. Use this if you already have the sub.",
    )

    action = p.add_mutually_exclusive_group(required=True)
    action.add_argument(
        "--grant", action="store_true", help="Add the user to signal-analytics-admin."
    )
    action.add_argument(
        "--revoke",
        action="store_true",
        help="Remove the user from signal-analytics-admin.",
    )
    action.add_argument(
        "--list",
        action="store_true",
        help="List the user's current Cognito groups without mutating.",
    )
    return p.parse_args()


def _resolve_pool_id(settings: Any) -> str:
    pool = (settings.cognito_user_pool_id or "").strip()
    if not pool:
        pool = (os.environ.get("NEXT_PUBLIC_COGNITO_USER_POOL_ID") or "").strip()
    if not pool:
        raise SystemExit(
            "Cognito user pool id missing. Set COGNITO_USER_POOL_ID or "
            "NEXT_PUBLIC_COGNITO_USER_POOL_ID."
        )
    return pool


def _resolve_username(client: Any, pool_id: str, *, email: str | None, user_id: str | None) -> str:
    """Return the Cognito *Username* value to pass to Admin* APIs.

    Cognito's ``Admin*`` APIs expect ``Username`` (which for our pool is
    the email). ``AdminGetUser`` accepts either the Username **or** the
    ``sub`` — we always normalize to Username for downstream calls.
    """
    if email:
        normalized = email.strip().lower()
        if not normalized:
            raise SystemExit("--email cannot be empty.")
        resp = client.admin_get_user(UserPoolId=pool_id, Username=normalized)
        return str(resp["Username"])
    if user_id:
        sub = user_id.strip()
        if not sub:
            raise SystemExit("--user-id cannot be empty.")
        resp = client.admin_get_user(UserPoolId=pool_id, Username=sub)
        return str(resp["Username"])
    raise SystemExit("Exactly one of --email / --user-id is required.")


def _list_groups(client: Any, pool_id: str, username: str) -> list[str]:
    groups: list[str] = []
    next_token: str | None = None
    while True:
        kwargs: dict[str, Any] = {"UserPoolId": pool_id, "Username": username, "Limit": 60}
        if next_token:
            kwargs["NextToken"] = next_token
        resp = client.admin_list_groups_for_user(**kwargs)
        groups.extend([str(g["GroupName"]) for g in resp.get("Groups", []) if g.get("GroupName")])
        next_token = resp.get("NextToken")
        if not next_token:
            break
    return groups


def main() -> None:
    _root = Path(__file__).resolve().parents[1]
    load_dotenv(_root / ".env")
    load_dotenv(_root / "frontend" / ".env.local")

    args = _parse_args()
    settings = get_settings()
    pool_id = _resolve_pool_id(settings)
    region = (settings.cognito_region or settings.aws_region or "us-east-1").strip()
    client = boto3.client("cognito-idp", region_name=region)

    try:
        username = _resolve_username(
            client,
            pool_id,
            email=getattr(args, "email", None),
            user_id=getattr(args, "user_id", None),
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        raise SystemExit(f"Cognito lookup failed ({code}): {exc}") from exc

    if args.list:
        groups = _list_groups(client, pool_id, username)
        print(
            json.dumps(
                {
                    "username": username,
                    "groups": groups,
                    "is_admin": ADMIN_GROUP_NAME in groups,
                },
                indent=2,
            )
        )
        return

    op = "add" if args.grant else "remove"
    try:
        if args.grant:
            client.admin_add_user_to_group(
                UserPoolId=pool_id, Username=username, GroupName=ADMIN_GROUP_NAME
            )
        else:
            client.admin_remove_user_from_group(
                UserPoolId=pool_id, Username=username, GroupName=ADMIN_GROUP_NAME
            )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        # ``ResourceNotFoundException`` on a remove typically means the
        # group doesn't exist yet — that is itself an actionable error,
        # so surface it loudly rather than silently shrugging.
        raise SystemExit(f"Cognito {op} failed ({code}): {exc}") from exc

    groups_after = _list_groups(client, pool_id, username)
    print(
        json.dumps(
            {
                "username": username,
                "action": op,
                "group": ADMIN_GROUP_NAME,
                "groups": groups_after,
                "is_admin": ADMIN_GROUP_NAME in groups_after,
            },
            indent=2,
        )
    )
    if args.grant and ADMIN_GROUP_NAME not in groups_after:
        print(
            "WARNING: grant succeeded but group not reflected in AdminListGroupsForUser "
            "— check Cognito eventual consistency.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
