#!/usr/bin/env python3
"""One-time (or idempotent) creation of Secrets Manager secret ``stocvest/signal-parameters``."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running without installing package as module
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import boto3  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

from stocvest.config.parameter_store import SECRET_NAME  # noqa: E402
from stocvest.config.signal_parameters import default_signal_parameters, signal_parameters_to_dict  # noqa: E402


def main() -> None:
    params = default_signal_parameters()
    params.version = "1.0.0"
    params.created_at = datetime.now(timezone.utc).isoformat()
    params.notes = "Initial parameters — theoretical baseline, tune after 30 days"
    payload = json.dumps(signal_parameters_to_dict(params), indent=2)
    client = boto3.client("secretsmanager")
    try:
        client.create_secret(Name=SECRET_NAME, SecretString=payload)
        print("Parameters initialized (create_secret).")
    except ClientError as exc:
        code = str((exc.response or {}).get("Error", {}).get("Code", ""))
        if code == "ResourceExistsException":
            client.update_secret(SecretId=SECRET_NAME, SecretString=payload)
            print("Parameters updated (secret already existed).")
        else:
            raise


if __name__ == "__main__":
    main()
