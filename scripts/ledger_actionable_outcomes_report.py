"""Read-only report: actionable ledger rows and directional outcomes over a window.

Usage:
  python scripts/ledger_actionable_outcomes_report.py --days 14
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from stocvest.api.services.historical_validation_service import HistoricalValidationService
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.signals.historical_validation import validate_signal_history

_ET = ZoneInfo("America/New_York")
_SHADOW = ":ledger_capture_shadow"


def _sanitize_dynamodb_endpoint_env() -> None:
    raw = (os.environ.get("DYNAMODB_ENDPOINT_URL") or "").strip()
    if raw and not raw.startswith("http"):
        os.environ["DYNAMODB_ENDPOINT_URL"] = ""
    try:
        from stocvest.utils.config import get_settings

        get_settings.cache_clear()
    except Exception:
        pass


def _decision_of(record) -> str:
    raw = str(getattr(record, "decision_state_entry", None) or "").strip().lower()
    if raw in ("actionable", "monitor", "blocked"):
        return raw
    if getattr(record, "ledger_qualified", False):
        return "actionable"
    return raw or "unknown"


def _is_ledger_row(record) -> bool:
    pattern = str(getattr(record, "pattern", None) or "")
    if _SHADOW in pattern:
        return True
    if getattr(record, "ledger_qualified", False):
        return True
    ck = str(getattr(record, "capture_kind", None) or "").strip().lower()
    return ck in ("qualified", "shadow")


def _fmt_acc(acc: float) -> str:
    return "n/a" if acc != acc else f"{100 * acc:.1f}%"


def _print_cohort(label: str, cohort: list) -> None:
    if not cohort:
        print(f"--- {label}: none ---\n")
        return
    for horizon in ("1h", "1d"):
        summary = validate_signal_history(cohort, horizon=horizon)
        o = summary.overall
        print(f"--- {label} | horizon {horizon} ---")
        print(f"  Resolved outcomes : {o.total_signals}")
        print(f"  Correct           : {o.correct}")
        print(f"  Incorrect         : {o.incorrect}")
        print(f"  Neutral           : {o.neutral}")
        print(f"  Directional acc   : {_fmt_acc(o.accuracy)}  (excludes neutral)")
        for mode in ("day", "swing"):
            b = summary.by_mode.get(mode)
            if not b or b.total_signals == 0:
                continue
            print(
                f"  {mode.upper():5} desk: {b.correct}W / {b.incorrect}L / {b.neutral}N"
                f"  acc={_fmt_acc(b.accuracy)}  n={b.total_signals}"
            )
        print()


def _fetch_all_public_rows(*, days: int) -> list:
    store = get_signal_recorder()
    from_at = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    to_at = datetime.now(timezone.utc)
    from_utc = from_at if from_at.tzinfo else from_at.replace(tzinfo=timezone.utc)

    page_fn = getattr(store, "get_user_signal_history_page", None)
    if not callable(page_fn):
        service = HistoricalValidationService(store)
        return service._fetch(user_id=None, from_at=from_at, to_at=to_at, mode=None, symbol=None)

    collected: list = []
    cursor: str | None = None
    while True:
        page, cursor = page_fn(
            user_id=None,
            symbol=None,
            days=days,
            page_size=500,
            mode=None,
            ledger_qualified_only=False,
            cursor=cursor,
        )
        for row in page:
            gen = row.generated_at
            if gen.tzinfo is None:
                gen = gen.replace(tzinfo=timezone.utc)
            if from_utc <= gen < to_at:
                collected.append(row)
        if not cursor:
            break
    return collected


def main() -> int:
    _sanitize_dynamodb_endpoint_env()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=14, help="Trailing window in days (default 14).")
    ap.add_argument("--max-symbols", type=int, default=50, help="Max per-row listing.")
    args = ap.parse_args()

    to_at = datetime.now(timezone.utc)
    from_at = to_at - timedelta(days=max(1, args.days))
    rows = _fetch_all_public_rows(days=args.days)

    ledger_rows = [r for r in rows if _is_ledger_row(r)]
    actionable = [r for r in ledger_rows if _decision_of(r) == "actionable"]
    qualified_actionable = [r for r in actionable if getattr(r, "ledger_qualified", False)]

    table = os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "?")
    now_et = datetime.now(_ET)
    print("=" * 72)
    print(f"STOCVEST LEDGER — ACTIONABLE OUTCOMES (last {args.days} days, public scope)")
    print(f"Window UTC : {from_at.date()} -> {to_at.date()}")
    print(f"Window ET  : {from_at.astimezone(_ET).date()} -> {now_et.date()}")
    print(f"Table      : {table}")
    print("=" * 72)
    print(f"All ledger rows in window      : {len(ledger_rows)}")
    print(f"Decision actionable (ledger)   : {len(actionable)}")
    print(f"Qualified + actionable         : {len(qualified_actionable)}")
    print()

    _print_cohort("ALL ACTIONABLE (ledger decision)", actionable)
    _print_cohort("QUALIFIED + ACTIONABLE (trade-ready)", qualified_actionable)

    print("--- ACTIONABLE symbols with 1d outcome (most recent first) ---")
    shown = 0
    with_1d = [
        r
        for r in sorted(actionable, key=lambda x: x.generated_at, reverse=True)
        if str(getattr(r, "outcome_1d", None) or "").strip().lower() in ("correct", "incorrect", "neutral")
    ]
    for r in with_1d[: args.max_symbols]:
        out = str(r.outcome_1d or "").strip().lower()
        gen_s = r.generated_at.astimezone(_ET).strftime("%Y-%m-%d %H:%M ET")
        qual = "Q" if r.ledger_qualified else "S"
        print(
            f"  {gen_s}  {r.symbol:6}  {r.mode:5}  [{qual}]  1d={out:9}  dir={r.direction}"
        )
        shown += 1
    if not shown:
        print("  (no resolved 1d outcomes yet in actionable cohort)")
    elif len(with_1d) > shown:
        print(f"  ... and {len(with_1d) - shown} more with 1d outcomes")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
