"""B71 Phase C — read-only news event-study report.

Scans the configured DynamoDB ``SignalHistory`` table, hydrates each row into a
:class:`SignalRecord`, and reports — per symbol — how much the stock tends to move
on news-bearing signals vs. quiet ones (``sensitivity_ratio``) and how often our
captured sentiment sign matched the realized move (``predictiveness``).

It does NOT write anything to the table and does NOT change live scoring. It is the
data-validation step before B71 Phase C "learn → bounded up-weight" is wired in.

Usage (from repo root, with AWS credentials configured):

  # Relies on app settings / .env for the table name:
  python scripts/news_event_study_report.py

  # Point at a table explicitly:
  python scripts/news_event_study_report.py --table SignalHistory --region us-east-1

  # Restrict window, horizon, desk, and reporting floor:
  python scripts/news_event_study_report.py --since-days 90 --horizon 1d --mode swing --min-samples 8

  # Export machine-readable results:
  python scripts/news_event_study_report.py --csv news_sensitivity.csv --json news_sensitivity.json

  # Run against a local fixture (JSON array of Dynamo-shaped items), no AWS needed:
  python scripts/news_event_study_report.py --fixture sample_items.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.data.models import SignalRecord
from stocvest.signals.news_event_study import (
    DEFAULT_MIN_NEWS_SAMPLES,
    SymbolSensitivity,
    aggregate_symbol_sensitivity,
    build_event_study_rows,
)


def _resolve_table_name(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
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
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        if not kwargs.get("region_name"):
            kwargs["region_name"] = settings.aws_region
        if name:
            return name, kwargs
    except Exception as exc:  # settings may require POLYGON_API_KEY etc.
        sys.stderr.write(f"[info] could not load app settings ({exc}); falling back to env.\n")
    name = os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "").strip()
    endpoint = os.environ.get("DYNAMODB_ENDPOINT_URL", "").strip()
    if endpoint.startswith("http"):
        kwargs["endpoint_url"] = endpoint
    return name, kwargs


def _parse_generated_at(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _load_items(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.fixture:
        with open(args.fixture, encoding="utf-8") as fh:
            data = json.load(fh)
        return list(data) if isinstance(data, list) else []
    table_name, res_kwargs = _resolve_table_name(args)
    if not table_name:
        sys.stderr.write(
            "No SignalHistory table resolved. Set DYNAMODB_SIGNAL_HISTORY_TABLE, "
            "configure app settings, or pass --table / --fixture.\n"
        )
        raise SystemExit(1)
    import boto3

    table = boto3.resource("dynamodb", **res_kwargs).Table(table_name)
    items: list[dict[str, Any]] = []
    scan_kwargs: dict[str, Any] = {}
    while True:
        resp = table.scan(**scan_kwargs)
        items.extend(resp.get("Items") or [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    return items


def _hydrate(
    items: list[dict[str, Any]],
    *,
    cutoff: datetime | None,
    mode: str,
    public_only: bool,
) -> tuple[list[SignalRecord], int]:
    records: list[SignalRecord] = []
    skipped = 0
    for item in items:
        if public_only and str(item.get("scope_key") or "") not in ("", "PUBLIC"):
            # When scope_key is absent we keep the row (fixtures); production rows carry it.
            if item.get("scope_key") is not None:
                continue
        if cutoff is not None:
            gen = _parse_generated_at(item.get("generated_at"))
            if gen is None or gen < cutoff:
                continue
        if mode != "all" and str(item.get("mode") or "day").strip().lower() != mode:
            continue
        try:
            records.append(SignalRecord.from_dynamo_item(item))
        except Exception:
            skipped += 1
    return records, skipped


def _print_report(
    table_label: str,
    horizon: str,
    mode: str,
    n_records: int,
    skipped: int,
    sensitivities: dict[str, SymbolSensitivity],
) -> None:
    print("=" * 78)
    print(f"News event study (B71 Phase C, read-only) - source: {table_label}")
    print(f"Horizon: {horizon}   Desk: {mode}   Records used: {n_records}   Skipped: {skipped}")
    print("=" * 78)
    if not sensitivities:
        print("\nNo symbols met the minimum resolved news-sample floor yet.")
        print("This is expected until Phase B capture + signal resolution accrue. Re-run later.")
        return

    ranked = sorted(
        sensitivities.values(),
        key=lambda s: (s.sensitivity_ratio if s.sensitivity_ratio is not None else -1.0),
        reverse=True,
    )
    print(f"\n{'SYMBOL':<8}{'NEWS_N':>7}{'BASE_N':>7}{'|ret|NEWS':>11}{'|ret|BASE':>11}{'SENS':>7}{'PRED':>7}{'PRED_N':>7}")
    print("-" * 78)
    for s in ranked:
        sens = f"{s.sensitivity_ratio:.2f}" if s.sensitivity_ratio is not None else "n/a"
        pred = f"{s.predictiveness:.0%}" if s.predictiveness is not None else "n/a"
        mn = f"{s.mean_abs_news:.4f}" if s.mean_abs_news is not None else "n/a"
        mb = f"{s.mean_abs_baseline:.4f}" if s.mean_abs_baseline is not None else "n/a"
        print(f"{s.symbol:<8}{s.n_news_resolved:>7}{s.n_baseline_resolved:>7}{mn:>11}{mb:>11}{sens:>7}{pred:>7}{s.n_predictive:>7}")
    print("-" * 78)
    print("SENS = mean|ret| on news days / on quiet days (>1 => news-sensitive).")
    print("PRED = sentiment-sign vs realized-move-sign agreement (50% ~ no skill).")
    print("Exploratory only - NOT wired into live scoring (see docs/BACKLOG.md B71).")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", default="", help="SignalHistory table name (overrides settings/env).")
    ap.add_argument("--region", default="", help="AWS region (e.g. us-east-1).")
    ap.add_argument("--fixture", default="", help="Local JSON array of Dynamo-shaped items (no AWS).")
    ap.add_argument("--since-days", type=int, default=0, help="Only use signals generated in the last N days.")
    ap.add_argument("--horizon", choices=("1h", "1d"), default="1d", help="Forward-return horizon.")
    ap.add_argument("--mode", choices=("day", "swing", "all"), default="all", help="Desk filter.")
    ap.add_argument(
        "--min-samples",
        type=int,
        default=DEFAULT_MIN_NEWS_SAMPLES,
        help="Minimum resolved news-bearing rows before a symbol is reported.",
    )
    ap.add_argument("--include-user-rows", action="store_true", help="Include USER#-scoped rows (default: public only).")
    ap.add_argument("--csv", default="", help="Optional path: write per-symbol sensitivity CSV.")
    ap.add_argument("--json", default="", help="Optional path: write per-symbol sensitivity JSON.")
    args = ap.parse_args()

    cutoff: datetime | None = None
    if args.since_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=args.since_days)

    items = _load_items(args)
    records, skipped = _hydrate(
        items, cutoff=cutoff, mode=args.mode, public_only=not args.include_user_rows
    )
    rows = build_event_study_rows(records, horizon=args.horizon)
    sensitivities = aggregate_symbol_sensitivity(rows, min_news_samples=args.min_samples)

    table_label = args.fixture or "(DynamoDB SignalHistory)"
    _print_report(table_label, args.horizon, args.mode, len(records), skipped, sensitivities)

    if args.csv and sensitivities:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(asdict(next(iter(sensitivities.values()))).keys()))
            writer.writeheader()
            for s in sensitivities.values():
                writer.writerow(asdict(s))
        print(f"\nWrote {len(sensitivities)} symbols to {args.csv}")

    if args.json and sensitivities:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({k: asdict(v) for k, v in sensitivities.items()}, fh, indent=2)
        print(f"Wrote {len(sensitivities)} symbols to {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
