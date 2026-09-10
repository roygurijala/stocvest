"""POS-AI-9 — tune the Position news recency-decay curve from the ledger.

Read-only. Scans ``SignalHistory`` for resolved Position ledger rows, joins each
signal's freshest captured news-article age to its realized directional outcome,
and prints the empirical hit-rate per age bucket alongside a data-driven
recommended decay curve — to COMPARE against the live curve in
``stocvest.signals.news_sentiment.position_recency_weight``.

**This script never changes live constants.** During the VAL-POS soak the ledger
is thin, so it will report ``insufficient_data`` and recommend nothing — which is
the intended behaviour until there is enough data to justify each bucket weight.

Usage (from repo root; AWS creds + table env configured):

  python scripts/tune_position_news_decay.py
  python scripts/tune_position_news_decay.py --days 365 --min-samples 40
  python scripts/tune_position_news_decay.py --table SignalHistory --region us-east-1
  python scripts/tune_position_news_decay.py --fixture path/to/rows.json   # offline, no AWS

``--fixture`` reads a JSON list of DynamoDB item dicts (same shape
``SignalRecord.from_dynamo_item`` consumes) so the tuner can run with no network.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_OUT = _REPO_ROOT / "reports" / "ledger"


def _valid_endpoint(url: str | None) -> str | None:
    raw = (url or "").strip()
    return raw if raw.startswith("http://") or raw.startswith("https://") else None


def _resolve_table_name(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    kwargs: dict[str, Any] = {}
    if args.region:
        kwargs["region_name"] = args.region
    if args.table:
        endpoint = _valid_endpoint(os.environ.get("DYNAMODB_ENDPOINT_URL"))
        if endpoint:
            kwargs["endpoint_url"] = endpoint
        return args.table.strip(), kwargs
    try:
        from stocvest.utils.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        name = (settings.dynamodb_signal_history_table or "").strip()
        endpoint = _valid_endpoint(settings.dynamodb_endpoint_url)
        if endpoint:
            kwargs["endpoint_url"] = endpoint
        if not kwargs.get("region_name"):
            kwargs["region_name"] = settings.aws_region
        if name:
            return name, kwargs
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[info] could not load app settings ({exc}); falling back to env.\n")
    name = os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "").strip()
    endpoint = _valid_endpoint(os.environ.get("DYNAMODB_ENDPOINT_URL"))
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return name, kwargs


def _parse_dt(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _load_records_from_items(items: list[dict[str, Any]], *, since: datetime | None) -> list[Any]:
    from stocvest.data.models import SignalRecord

    out: list[Any] = []
    for item in items:
        if str(item.get("mode") or "").strip().lower() != "position":
            continue
        # PUBLIC mirror rows only, to avoid double-counting user + mirror pairs.
        if str(item.get("scope_key") or "") not in ("PUBLIC", ""):
            continue
        try:
            rec = SignalRecord.from_dynamo_item(item)
        except Exception:  # noqa: BLE001 — skip malformed rows
            continue
        if since is not None:
            gen = rec.generated_at
            gen = gen if (gen and gen.tzinfo) else (gen.replace(tzinfo=timezone.utc) if gen else None)
            if gen is not None and gen < since:
                continue
        out.append(rec)
    return out


def _scan_table_items(table: Any) -> list[dict[str, Any]]:
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


def _format_report(report: dict[str, Any], *, table_label: str, window_label: str) -> str:
    lines: list[str] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines.append("STOCVEST - Position news recency-decay tuner (POS-AI-9)")
    lines.append(f"Generated       : {now}")
    lines.append(f"Source          : {table_label}")
    lines.append(f"Window          : {window_label}")
    lines.append(f"Resolved samples: {report['n_samples']}  (min/bucket: {report['min_samples_per_bucket']})")
    lines.append("")
    lines.append("Per age-bucket (freshest article age at signal time):")
    lines.append("  bucket    n   correct  hit-rate   95% CI            live")
    for b in report["buckets"]:
        hr = "  n/a " if b["hit_rate"] is None else f"{b['hit_rate']*100:5.1f}%"
        ci = "        -        " if b["wilson_ci"] is None else f"[{b['wilson_ci'][0]*100:4.1f},{b['wilson_ci'][1]*100:4.1f}]%"
        lines.append(
            f"  {b['bucket']:<7} {b['n']:>4}   {b['correct']:>5}   {hr}   {ci:<17}  {b['live_weight']:.2f}"
        )
    lines.append("")
    lines.append(f"Status: {report['status']} - {report['reason']}")
    lines.append("")
    live = report["live_curve"]
    rec = report["recommended_curve"]
    lines.append("  bucket    live -> recommended")
    for label in ("0-7", "8-14", "15-21", "22-30", "31+"):
        rv = "     (unchanged)" if rec is None else f"{rec[label]:.2f}"
        lines.append(f"  {label:<7}  {live[label]:.2f} -> {rv}")
    lines.append("")
    lines.append("NOTE: This is a REPORT ONLY. Live constants in position_recency_weight are")
    lines.append("      NOT modified. Review the curve + sample sizes before proposing any change.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--table", default="", help="SignalHistory table name override.")
    ap.add_argument("--region", default="", help="AWS region override.")
    ap.add_argument("--days", type=int, default=365, help="Lookback window in days (default 365).")
    ap.add_argument(
        "--min-samples",
        type=int,
        default=None,
        help="Minimum resolved signals per populated bucket before a curve is recommended.",
    )
    ap.add_argument("--fixture", default="", help="Offline JSON list of DynamoDB item dicts (no AWS).")
    ap.add_argument("--output-dir", default=str(_DEFAULT_OUT), help="Directory for the saved report.")
    args = ap.parse_args()

    from stocvest.signals.position_news_decay_tuning import (
        DEFAULT_MIN_SAMPLES_PER_BUCKET,
        build_decay_tuning_report,
    )

    min_samples = args.min_samples if args.min_samples is not None else DEFAULT_MIN_SAMPLES_PER_BUCKET
    since = datetime.now(timezone.utc) - timedelta(days=max(1, int(args.days)))
    window_label = f"last {args.days} days (since {since.date().isoformat()})"

    if args.fixture:
        fixture_path = Path(args.fixture)
        try:
            items = json.loads(fixture_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            sys.stderr.write(f"could not read fixture {fixture_path}: {exc}\n")
            return 1
        if not isinstance(items, list):
            sys.stderr.write("fixture must be a JSON list of item dicts\n")
            return 1
        records = _load_records_from_items(items, since=since)
        table_label = f"fixture:{fixture_path.name}"
    else:
        import boto3

        table_name, res_kwargs = _resolve_table_name(args)
        if not table_name:
            sys.stderr.write("Set DYNAMODB_SIGNAL_HISTORY_TABLE or pass --table (or use --fixture).\n")
            return 1
        table = boto3.resource("dynamodb", **res_kwargs).Table(table_name)
        records = _load_records_from_items(_scan_table_items(table), since=since)
        table_label = f"SignalHistory table {table_name}"

    report = build_decay_tuning_report(records, min_samples=min_samples)
    body = _format_report(report, table_label=table_label, window_label=window_label)
    print(body)

    out_dir = Path(args.output_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = date.today().isoformat()
        out_path = out_dir / f"{stamp}_position_news_decay_tuning.txt"
        out_path.write_text(body + "\n\n--- machine-readable ---\n" + json.dumps(report, indent=2), encoding="utf-8")
        print(f"Saved report -> {out_path}")
    except OSError as exc:
        sys.stderr.write(f"[warn] could not write report file: {exc}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
