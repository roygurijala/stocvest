"""Read-only audit of SignalHistory: how many resolved signals exist per desk,
and how close we are to being able to *fit* layer weights for real.

This answers one question: "Do we have enough resolved, non-neutral signals with
stored layer_scores to run the weight optimizer per desk (day / swing)?"

It does NOT write anything. It scans the configured DynamoDB SignalHistory table,
hydrates each row into a SignalRecord, and reports per-desk counts against the
thresholds the codebase already uses:

  * PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL = 50  (public accuracy disclosure floor)
  * PROMOTION_MIN_RESOLVED            = 30      (min resolved to promote a param set)

"Fittable" here means the weight optimizer's denominator: a row that is resolved
with a non-neutral outcome AND carries a non-empty layer_scores map.

Usage (from repo root, with AWS credentials configured):

  # Easiest — relies on app settings / .env for the table name:
  python scripts/signal_history_readiness.py

  # Or point at a table explicitly (no app env needed beyond AWS creds):
  python scripts/signal_history_readiness.py --table SignalHistory --region us-east-1

  # Restrict to the last N days of signals:
  python scripts/signal_history_readiness.py --since-days 90

  # Dump a per-desk CSV of fittable rows for offline analysis:
  python scripts/signal_history_readiness.py --csv fittable_rows.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3

# --- Thresholds (import the canonical values; fall back to literals if the
#     import chain is unavailable in a bare environment). --------------------
try:
    from stocvest.signals.product_kpi import (
        PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL,
        PROMOTION_MIN_RESOLVED,
        is_product_kpi_cohort_row,
        is_product_kpi_scored_row,
    )

    _HAVE_KPI = True
except Exception:  # pragma: no cover - defensive for bare runs
    PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL = 50
    PROMOTION_MIN_RESOLVED = 30
    _HAVE_KPI = False

try:
    from stocvest.data.models import SignalRecord

    _HAVE_MODEL = True
except Exception:  # pragma: no cover
    SignalRecord = None  # type: ignore[assignment]
    _HAVE_MODEL = False

# Comfortable target for a stable per-desk walk-forward weight fit. The optimizer
# tolerates ~30 rows, but the per-layer signal is noisy below ~100.
COMFORTABLE_FIT_TARGET = 100


@dataclass
class DeskStats:
    total: int = 0
    resolved_1h: int = 0
    resolved_1d: int = 0
    nonneutral_1h: int = 0
    nonneutral_1d: int = 0
    with_layer_scores: int = 0
    fittable_1d: int = 0  # resolved non-neutral 1d AND has layer_scores
    fittable_1h: int = 0
    cohort_total: int = 0  # product-KPI cohort (qualified + actionable + ledger_qualified)
    cohort_scored_1d: int = 0
    capture_kinds: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    earliest: datetime | None = None
    latest: datetime | None = None


def _resolve_table_name(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    """Resolve table name + boto3 resource kwargs from arg > settings > env."""
    kwargs: dict[str, Any] = {}
    if args.region:
        kwargs["region_name"] = args.region

    if args.table:
        endpoint = os.environ.get("DYNAMODB_ENDPOINT_URL", "").strip()
        if endpoint.startswith("http"):
            kwargs["endpoint_url"] = endpoint
        return args.table.strip(), kwargs

    # Try app settings (matches purge_signal_history.py convention).
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


def _parse_generated_at(item: dict[str, Any]) -> datetime | None:
    raw = item.get("generated_at")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _desk_of(item: dict[str, Any]) -> str:
    mode = str(item.get("mode") or "").strip().lower()
    if mode in ("day", "swing"):
        return mode
    return "unknown"


def _has_layer_scores(item: dict[str, Any]) -> bool:
    ls = item.get("layer_scores")
    return isinstance(ls, dict) and len(ls) > 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--table", default="", help="SignalHistory table name (overrides settings/env).")
    ap.add_argument("--region", default="", help="AWS region (e.g. us-east-1).")
    ap.add_argument("--since-days", type=int, default=0, help="Only count signals generated in the last N days.")
    ap.add_argument("--csv", default="", help="Optional path: dump fittable (resolved non-neutral + layer_scores) rows.")
    args = ap.parse_args()

    table_name, res_kwargs = _resolve_table_name(args)
    if not table_name:
        sys.stderr.write(
            "No SignalHistory table resolved. Set DYNAMODB_SIGNAL_HISTORY_TABLE, "
            "configure app settings, or pass --table.\n"
        )
        return 1

    cutoff: datetime | None = None
    if args.since_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=args.since_days)

    dynamodb = boto3.resource("dynamodb", **res_kwargs)
    table = dynamodb.Table(table_name)

    desks: dict[str, DeskStats] = defaultdict(DeskStats)
    csv_rows: list[dict[str, Any]] = []
    scanned = 0
    skipped_parse = 0

    scan_kwargs: dict[str, Any] = {}
    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items") or []:
            scanned += 1
            gen = _parse_generated_at(item)
            if cutoff is not None and (gen is None or gen < cutoff):
                continue

            desk = _desk_of(item)
            st = desks[desk]
            st.total += 1
            if gen is not None:
                st.earliest = gen if st.earliest is None else min(st.earliest, gen)
                st.latest = gen if st.latest is None else max(st.latest, gen)

            st.capture_kinds[str(item.get("capture_kind") or "unspecified")] += 1

            out_1h = str(item.get("outcome_1h") or "").strip().lower()
            out_1d = str(item.get("outcome_1d") or "").strip().lower()
            res_1h = bool(item.get("resolved_1h")) or out_1h in ("correct", "incorrect", "neutral")
            res_1d = bool(item.get("resolved_1d")) or out_1d in ("correct", "incorrect", "neutral")
            if res_1h:
                st.resolved_1h += 1
            if res_1d:
                st.resolved_1d += 1
            nn_1h = out_1h in ("correct", "incorrect")
            nn_1d = out_1d in ("correct", "incorrect")
            if nn_1h:
                st.nonneutral_1h += 1
            if nn_1d:
                st.nonneutral_1d += 1

            has_ls = _has_layer_scores(item)
            if has_ls:
                st.with_layer_scores += 1
            if nn_1d and has_ls:
                st.fittable_1d += 1
                if args.csv:
                    csv_rows.append(
                        {
                            "signal_id": item.get("signal_id"),
                            "desk": desk,
                            "symbol": item.get("symbol"),
                            "direction": item.get("direction"),
                            "generated_at": gen.isoformat() if gen else "",
                            "outcome_1d": out_1d,
                            "signal_strength": item.get("signal_strength"),
                            "ledger_qualified": item.get("ledger_qualified"),
                            "capture_kind": item.get("capture_kind"),
                            **{f"layer_{k}": v for k, v in (item.get("layer_scores") or {}).items()},
                        }
                    )
            if nn_1h and has_ls:
                st.fittable_1h += 1

            # Canonical product-KPI cohort (qualified + actionable + ledger_qualified).
            if _HAVE_KPI and _HAVE_MODEL:
                try:
                    rec = SignalRecord.from_dynamo_item(item)  # type: ignore[union-attr]
                    if is_product_kpi_cohort_row(rec):
                        st.cohort_total += 1
                        if is_product_kpi_scored_row(rec, horizon="1d"):
                            st.cohort_scored_1d += 1
                except Exception:
                    skipped_parse += 1

        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek

    _print_report(table_name, desks, scanned, skipped_parse, cutoff)

    if args.csv and csv_rows:
        fieldnames: list[str] = []
        for r in csv_rows:
            for k in r:
                if k not in fieldnames:
                    fieldnames.append(k)
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)
        print(f"\nWrote {len(csv_rows)} fittable rows to {args.csv}")

    return 0


def _fmt_range(st: DeskStats) -> str:
    if not st.earliest or not st.latest:
        return "n/a"
    days = (st.latest - st.earliest).days
    return f"{st.earliest.date()} → {st.latest.date()} ({days}d span)"


def _verdict(fittable: int) -> str:
    if fittable >= COMFORTABLE_FIT_TARGET:
        return "READY (comfortable)"
    if fittable >= PROMOTION_MIN_RESOLVED:
        return "MARGINAL (can fit, expect noise)"
    return "NOT YET (too few rows)"


def _print_report(
    table_name: str,
    desks: dict[str, DeskStats],
    scanned: int,
    skipped_parse: int,
    cutoff: datetime | None,
) -> None:
    print("=" * 72)
    print(f"SignalHistory readiness — table: {table_name}")
    print(f"Rows scanned: {scanned}" + (f"  (window: last {cutoff.date()}+)" if cutoff else ""))
    if skipped_parse:
        print(f"Rows that failed cohort hydration (counted elsewhere): {skipped_parse}")
    if not _HAVE_KPI:
        print("[warn] product_kpi helpers unavailable — cohort columns are zero.")
    print("=" * 72)

    order = [d for d in ("day", "swing", "unknown") if d in desks]
    for desk in order:
        st = desks[desk]
        print(f"\n### {desk.upper()} DESK")
        print(f"  Date range            : {_fmt_range(st)}")
        print(f"  Total signals         : {st.total}")
        print(f"  Resolved (1h / 1d)    : {st.resolved_1h} / {st.resolved_1d}")
        print(f"  Non-neutral (1h / 1d) : {st.nonneutral_1h} / {st.nonneutral_1d}")
        print(f"  With layer_scores     : {st.with_layer_scores}")
        print(f"  FITTABLE (1d)         : {st.fittable_1d}   <- weight-optimizer denominator")
        print(f"  FITTABLE (1h)         : {st.fittable_1h}")
        print(f"  Product-KPI cohort    : {st.cohort_total} total / {st.cohort_scored_1d} scored (1d)")
        kinds = ", ".join(f"{k}={v}" for k, v in sorted(st.capture_kinds.items())) or "n/a"
        print(f"  Capture kinds         : {kinds}")
        print(f"  >> Fit readiness (1d) : {_verdict(st.fittable_1d)}")

    print("\n" + "-" * 72)
    print("Reference thresholds:")
    print(f"  Public accuracy disclosure floor : {PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL} resolved non-neutral")
    print(f"  Param-promotion minimum          : {PROMOTION_MIN_RESOLVED} resolved")
    print(f"  Comfortable per-desk fit target  : {COMFORTABLE_FIT_TARGET} fittable rows")
    print("-" * 72)


if __name__ == "__main__":
    raise SystemExit(main())
