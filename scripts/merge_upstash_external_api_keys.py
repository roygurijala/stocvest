"""Merge Upstash REST credentials into AWS Secrets Manager ``stocvest/external-api-keys``.

Reads current JSON, adds or updates:
  - upstash_redis_rest_url
  - upstash_redis_rest_token

Credentials (in order of precedence):
  1. CLI: ``--url`` and ``--token``
  2. Environment: ``UPSTASH_REDIS_REST_URL`` / ``UPSTASH_REDIS_REST_TOKEN``

Usage:
  set UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
  set UPSTASH_REDIS_REST_TOKEN=xxx
  python scripts/merge_upstash_external_api_keys.py

  python scripts/merge_upstash_external_api_keys.py --url https://... --token ...
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import boto3

try:
    from dotenv import load_dotenv

    _root = Path(__file__).resolve().parents[1]
    load_dotenv(_root / ".env")
    load_dotenv(_root / "frontend" / ".env.local")
except ImportError:
    pass


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Merge Upstash keys into stocvest/external-api-keys secret.")
    p.add_argument(
        "--secret-id",
        default=os.environ.get("STOCVEST_EXTERNAL_API_KEYS_SECRET", "stocvest/external-api-keys"),
        help="Secrets Manager secret id or ARN.",
    )
    p.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1",
        help="AWS region for Secrets Manager.",
    )
    p.add_argument("--url", default="", help="Upstash REST URL (or set UPSTASH_REDIS_REST_URL).")
    p.add_argument("--token", default="", help="Upstash REST token (or set UPSTASH_REDIS_REST_TOKEN).")
    p.add_argument("--dry-run", action="store_true", help="Print merged JSON only; do not write.")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    url = (args.url or os.environ.get("UPSTASH_REDIS_REST_URL") or "").strip()
    token = (args.token or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    if not url or not token:
        print(
            "Missing Upstash credentials. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, "
            "or pass --url and --token.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    client = boto3.client("secretsmanager", region_name=args.region)
    resp = client.get_secret_value(SecretId=args.secret_id)
    raw = resp.get("SecretString") or ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(f"Secret is not valid JSON: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    if not isinstance(payload, dict):
        print("Secret JSON root must be an object.", file=sys.stderr)
        raise SystemExit(2)

    payload["upstash_redis_rest_url"] = url
    payload["upstash_redis_rest_token"] = token

    out = json.dumps(payload, indent=2, sort_keys=True)
    if args.dry_run:
        print(out)
        return

    client.put_secret_value(SecretId=args.secret_id, SecretString=json.dumps(payload, separators=(",", ":")))
    print(f"Updated {args.secret_id!r} with upstash_redis_rest_url + upstash_redis_rest_token (region={args.region}).")


if __name__ == "__main__":
    main()
