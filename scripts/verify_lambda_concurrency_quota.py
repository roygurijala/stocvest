#!/usr/bin/env python3
"""Verify Lambda account concurrent-execution quota meets OPS-2 minimum."""

from __future__ import annotations

import json
import subprocess
import sys

REGION = "us-east-1"
QUOTA_CODE = "L-B99A9384"
SERVICE_CODE = "lambda"
MINIMUM_RECOMMENDED = 100


def main() -> int:
    raw = subprocess.check_output(
        [
            "aws",
            "service-quotas",
            "get-service-quota",
            "--service-code",
            SERVICE_CODE,
            "--quota-code",
            QUOTA_CODE,
            "--region",
            REGION,
            "--output",
            "json",
        ],
        text=True,
    )
    quota = float(json.loads(raw)["Quota"]["Value"])
    print(f"Lambda concurrent execution quota: {quota:g}")
    if quota < MINIMUM_RECOMMENDED:
        print(
            f"FAIL: quota {quota:g} is below OPS-2 minimum {MINIMUM_RECOMMENDED}. "
            "Do not re-enable background jobs.",
            file=sys.stderr,
        )
        return 1
    print(f"OK: quota meets OPS-2 minimum ({MINIMUM_RECOMMENDED}+).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
