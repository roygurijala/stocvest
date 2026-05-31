#!/usr/bin/env python3
"""Backfill PUBLIC platform-mirror rows for existing SignalHistory captures.

Run from repo root with AWS creds and ``DYNAMODB_SIGNAL_HISTORY_TABLE`` set.
Skips rows that already have a ``pub-{signal_id}`` mirror.

  python scripts/backfill_platform_backtest_mirror.py
  python scripts/backfill_platform_backtest_mirror.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# .env.example comments must not become boto3 endpoint URLs.
_ep = (os.environ.get("DYNAMODB_ENDPOINT_URL") or "").strip()
if not _ep or _ep.startswith("#"):
    os.environ.pop("DYNAMODB_ENDPOINT_URL", None)

from stocvest.api.services.signal_backtest_capture import (  # noqa: E402
    enrich_record_for_backtest,
    mirror_platform_backtest_row,
    platform_mirror_signal_id,
)
from stocvest.api.services.signal_recorder import get_signal_recorder  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    store = get_signal_recorder()
    scan = getattr(store, "scan_all_records", None)
    if not callable(scan):
        print("Recorder does not support scan_all_records.", file=sys.stderr)
        return 1
    records = scan()
    written = skipped = 0
    for rec in records:
        if not rec.user_id:
            skipped += 1
            continue
        mid = platform_mirror_signal_id(rec.signal_id)
        if store.get_signal_record_raw(mid) is not None:
            skipped += 1
            continue
        enriched = enrich_record_for_backtest(rec)
        if args.dry_run:
            written += 1
            continue
        mirror_platform_backtest_row(enriched)
        written += 1
    print(f"mirrors {'would write' if args.dry_run else 'wrote'}={written} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
