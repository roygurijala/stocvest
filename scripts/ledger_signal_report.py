"""Build daily / weekly / monthly ledger signal reports from SignalHistory.

Read-only scan of DynamoDB. Writes a plain-text report under ``reports/ledger/``.

Usage (from repo root, AWS creds + table env configured):

  python scripts/ledger_signal_report.py --period daily
  python scripts/ledger_signal_report.py --period weekly
  python scripts/ledger_signal_report.py --period monthly
  python scripts/ledger_signal_report.py --period daily --date 2026-06-09

See ``docs/LEDGER_DAILY_VERIFICATION.md`` for the full runbook.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import boto3

_ET = ZoneInfo("America/New_York")
_REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_OUT = _REPO_ROOT / "reports" / "ledger"
_SHADOW_SUFFIX = ":ledger_capture_shadow"


def _valid_endpoint(url: str | None) -> str | None:
    raw = (url or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return None


def _sanitize_dynamodb_endpoint_env() -> None:
    if not _valid_endpoint(os.environ.get("DYNAMODB_ENDPOINT_URL")):
        os.environ["DYNAMODB_ENDPOINT_URL"] = ""
    try:
        from stocvest.utils.config import get_settings

        get_settings.cache_clear()
    except Exception:
        pass


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
    except Exception as exc:
        sys.stderr.write(f"[info] could not load app settings ({exc}); falling back to env.\n")
    name = os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "").strip()
    endpoint = _valid_endpoint(os.environ.get("DYNAMODB_ENDPOINT_URL"))
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return name, kwargs


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _et_date_of(item: dict[str, Any]) -> date | None:
    led = str(item.get("ledger_entry_date_et") or "").strip()
    if led:
        try:
            return date.fromisoformat(led[:10])
        except ValueError:
            pass
    gen = _parse_dt(item.get("generated_at"))
    if gen is None:
        return None
    return gen.astimezone(_ET).date()


def _is_ledger_row(item: dict[str, Any]) -> bool:
    pattern = str(item.get("pattern") or "")
    if _SHADOW_SUFFIX in pattern:
        return True
    if item.get("ledger_qualified") is True:
        return True
    blob = str(item.get("gate_status_json") or "")
    if "ledger_capture" in blob:
        return True
    if str(item.get("capture_kind") or "").strip().lower() in ("qualified", "shadow"):
        eval_src = ""
        try:
            parsed = json.loads(blob) if blob else {}
            if isinstance(parsed, dict):
                eval_src = str(parsed.get("evaluation_source") or "")
        except json.JSONDecodeError:
            eval_src = ""
        if eval_src == "ledger_capture":
            return True
    return False


def _decision_state(item: dict[str, Any]) -> str:
    raw = str(item.get("decision_state_entry") or "").strip().lower()
    if raw in ("actionable", "monitor", "blocked"):
        return raw
    try:
        from stocvest.api.services.signal_backtest_capture import (
            decision_state_from_gate_blob,
        )

        from_gates = decision_state_from_gate_blob(str(item.get("gate_status_json") or ""))
        if from_gates:
            return from_gates
    except Exception:
        pass
    if item.get("ledger_qualified") is True:
        return "actionable"
    if str(item.get("direction") or "").strip().lower() == "neutral":
        return "monitor"
    return "blocked"


def _period_window(period: str, anchor: date) -> tuple[date, date, str]:
    if period == "daily":
        return anchor, anchor, f"{anchor.isoformat()} (ET)"
    if period == "weekly":
        start = anchor - timedelta(days=6)
        return start, anchor, f"{start.isoformat()} to {anchor.isoformat()} (ET, 7 days)"
    if period == "monthly":
        start = anchor.replace(day=1)
        if anchor.month == 12:
            end = date(anchor.year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(anchor.year, anchor.month + 1, 1) - timedelta(days=1)
        return start, end, f"{start.isoformat()} to {end.isoformat()} (ET calendar month)"
    raise ValueError(f"unknown period: {period}")


@dataclass
class DeskTally:
    ledger_rows: int = 0
    qualified: int = 0
    shadow: int = 0
    actionable: int = 0
    monitor: int = 0
    blocked: int = 0
    symbols: set[str] = field(default_factory=set)

    def add(self, item: dict[str, Any]) -> None:
        self.ledger_rows += 1
        sym = str(item.get("symbol") or "").strip().upper()
        if sym:
            self.symbols.add(sym)
        if item.get("ledger_qualified") is True:
            self.qualified += 1
        else:
            self.shadow += 1
        ds = _decision_state(item)
        if ds == "actionable":
            self.actionable += 1
        elif ds == "monitor":
            self.monitor += 1
        else:
            self.blocked += 1


def _scan_ledger_rows(
    table: Any,
    *,
    start: date,
    end: date,
    platform_only: bool,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    scan_kwargs: dict[str, Any] = {}
    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items") or []:
            if platform_only and str(item.get("scope_key") or "") != "PUBLIC":
                continue
            if not _is_ledger_row(item):
                continue
            d = _et_date_of(item)
            if d is None or d < start or d > end:
                continue
            rows.append(item)
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    return rows


def _maturation_actionable_counts(start: date, end: date) -> dict[str, int]:
    """Best-effort WatchlistMaturation actionable rows in the window (optional)."""
    out: dict[str, int] = {"day": 0, "swing": 0}
    table_name = (os.environ.get("DYNAMODB_WATCHLIST_MATURATION_TABLE") or "").strip()
    if not table_name:
        try:
            from stocvest.utils.config import get_settings

            table_name = (get_settings().dynamodb_watchlist_maturation_table or "").strip()
        except Exception:
            return out
    if not table_name:
        return out
    region = os.environ.get("AWS_REGION", "us-east-1")
    tbl = boto3.resource("dynamodb", region_name=region).Table(table_name)
    scan_kwargs: dict[str, Any] = {}
    while True:
        resp = tbl.scan(**scan_kwargs)
        for item in resp.get("Items") or []:
            if str(item.get("state") or "").strip().lower() != "actionable":
                continue
            mode = str(item.get("mode") or "").strip().lower()
            if mode not in out:
                continue
            ev = _parse_dt(item.get("last_evaluated_at"))
            if ev is None:
                continue
            d = ev.astimezone(_ET).date()
            if start <= d <= end:
                out[mode] += 1
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    return out


def _format_report(
    *,
    period: str,
    window_label: str,
    table_name: str,
    start: date,
    end: date,
    desks: dict[str, DeskTally],
    maturation: dict[str, int],
    sample_rows: list[dict[str, Any]],
) -> str:
    lines: list[str] = []
    now_et = datetime.now(_ET).strftime("%Y-%m-%d %H:%M %Z")
    lines.append("STOCVEST - Ledger signal report")
    lines.append(f"Generated (local run): {now_et}")
    lines.append(f"Period type          : {period}")
    lines.append(f"Window (ET)          : {window_label}")
    lines.append(f"SignalHistory table  : {table_name}")
    lines.append("")
    lines.append("WHAT THIS COUNTS")
    lines.append("- Platform ledger captures from the scheduled jobs:")
    lines.append("    Day desk   - ~3:55 PM ET (ledger_capture_day)")
    lines.append("    Swing desk - ~4:00 PM ET (ledger_capture_swing)")
    lines.append("- Qualified = passed all ledger gates (ledger_qualified=true).")
    lines.append("- Shadow    = gate audit row (ledger_qualified=false, still saved).")
    lines.append("- Actionable / monitor / blocked = decision_state on each row.")
    lines.append("- Rows counted once via PUBLIC mirror scope (no per-user double count).")
    lines.append("")
    for desk in ("day", "swing"):
        st = desks.get(desk) or DeskTally()
        lines.append(f"--- {desk.upper()} DESK ---")
        lines.append(f"  Ledger rows (total)     : {st.ledger_rows}")
        lines.append(f"  Qualified (trade-ready) : {st.qualified}")
        lines.append(f"  Shadow (audit only)     : {st.shadow}")
        lines.append(f"  Decision actionable     : {st.actionable}")
        lines.append(f"  Decision monitor        : {st.monitor}")
        lines.append(f"  Decision blocked        : {st.blocked}")
        lines.append(f"  Unique symbols          : {len(st.symbols)}")
        if st.symbols:
            preview = ", ".join(sorted(st.symbols)[:20])
            suffix = " ..." if len(st.symbols) > 20 else ""
            lines.append(f"  Symbols                 : {preview}{suffix}")
        lines.append("")
    lines.append("--- WATCHLIST MATURATION (actionable state, same ET window) ---")
    lines.append("  (Separate from ledger - shows watchlist rows marked actionable.)")
    lines.append(f"  Day actionable rows     : {maturation.get('day', 0)}")
    lines.append(f"  Swing actionable rows   : {maturation.get('swing', 0)}")
    lines.append("")
    if sample_rows:
        lines.append("--- SAMPLE ROWS (up to 15, newest first) ---")
        for item in sample_rows[:15]:
            sym = item.get("symbol")
            mode = item.get("mode")
            qual = item.get("ledger_qualified")
            ds = _decision_state(item)
            led = item.get("ledger_entry_date_et") or _et_date_of(item)
            lines.append(f"  {led}  {mode}  {sym}  qualified={qual}  decision={ds}")
    lines.append("")
    lines.append("--- QUICK HEALTH CHECK ---")
    day_q = (desks.get("day") or DeskTally()).qualified
    swing_q = (desks.get("swing") or DeskTally()).qualified
    if start == end and start.weekday() < 5:
        if day_q == 0 and swing_q == 0:
            lines.append("  NOTE: Weekday with zero qualified rows - check ledger_capture schedules")
            lines.append("        ran after 4 PM ET, or all symbols failed gates.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    _sanitize_dynamodb_endpoint_env()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--period",
        choices=("daily", "weekly", "monthly"),
        default="daily",
        help="Report window (ET calendar).",
    )
    ap.add_argument(
        "--date",
        default="",
        help="Anchor date YYYY-MM-DD in America/New_York (default: yesterday ET).",
    )
    ap.add_argument("--table", default="", help="SignalHistory table name override.")
    ap.add_argument("--region", default="", help="AWS region override.")
    ap.add_argument(
        "--output-dir",
        default=str(_DEFAULT_OUT),
        help="Directory for saved reports (default: reports/ledger).",
    )
    ap.add_argument(
        "--include-user-rows",
        action="store_true",
        help="Count all user partitions too (usually duplicates mirror rows).",
    )
    args = ap.parse_args()

    if args.date:
        try:
            anchor = date.fromisoformat(args.date.strip())
        except ValueError:
            sys.stderr.write("--date must be YYYY-MM-DD\n")
            return 1
    else:
        anchor = (datetime.now(_ET) - timedelta(days=1)).date()

    start, end, window_label = _period_window(args.period, anchor)
    table_name, res_kwargs = _resolve_table_name(args)
    if not table_name:
        sys.stderr.write(
            "Set DYNAMODB_SIGNAL_HISTORY_TABLE or pass --table.\n"
        )
        return 1

    dynamodb = boto3.resource("dynamodb", **res_kwargs)
    table = dynamodb.Table(table_name)
    platform_only = not args.include_user_rows
    rows = _scan_ledger_rows(table, start=start, end=end, platform_only=platform_only)

    desks: dict[str, DeskTally] = defaultdict(DeskTally)
    for item in rows:
        mode = str(item.get("mode") or "").strip().lower()
        if mode not in ("day", "swing"):
            mode = "unknown"
        desks[mode].add(item)

    sample = sorted(
        rows,
        key=lambda x: (_et_date_of(x) or date.min, str(x.get("symbol") or "")),
        reverse=True,
    )
    maturation = _maturation_actionable_counts(start, end)
    body = _format_report(
        period=args.period,
        window_label=window_label,
        table_name=table_name,
        start=start,
        end=end,
        desks=desks,
        maturation=maturation,
        sample_rows=sample,
    )

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.period == "daily":
        fname = f"{end.isoformat()}_daily.txt"
    elif args.period == "weekly":
        fname = f"{end.isoformat()}_weekly.txt"
    else:
        fname = f"{start.strftime('%Y-%m')}_monthly.txt"
    out_path = out_dir / fname
    out_path.write_text(body, encoding="utf-8")
    print(body)
    print(f"\nSaved report -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
