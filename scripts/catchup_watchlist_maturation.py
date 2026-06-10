"""One-time catch-up: refresh WatchlistMaturation from live composites (default watchlists only).

Does not read or write SignalHistory. Upserts maturation rows via the same
``sync_watchlist_maturation_from_composite`` path as Evidence / ledger capture.

Usage (from repo root, with AWS credentials and app env):

  # Preview planned composite + sync work:
  python scripts/catchup_watchlist_maturation.py --dry-run

  # Limit breadth:
  python scripts/catchup_watchlist_maturation.py --dry-run --desk swing --max-calls 50

  # Execute (requires confirmation env):
  set STOCVEST_CONFIRM_MATURATION_CATCHUP=yes
  python scripts/catchup_watchlist_maturation.py --execute
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Literal
from zoneinfo import ZoneInfo

from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.services.watchlist_maturation_sync import sync_watchlist_maturation_from_composite
from stocvest.api.services.watchlist_plan_limits import watchlist_symbol_cap_for_profile
from stocvest.data.watchlist_maturation_repository import (
    WatchlistMaturationRepository,
    get_watchlist_maturation_repository,
)
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.models.watchlist import WatchlistState

CatchupDesk = Literal["day", "swing", "both"]
_ET = ZoneInfo("America/New_York")
_CONFIRM_ENV = "STOCVEST_CONFIRM_MATURATION_CATCHUP"


def _sanitize_dynamodb_endpoint_env() -> None:
    """Drop invalid ``DYNAMODB_ENDPOINT_URL`` values (e.g. .env comment debris)."""
    from stocvest.utils.config import get_settings

    raw = (os.environ.get("DYNAMODB_ENDPOINT_URL") or "").strip()
    if not raw.startswith("http://") and not raw.startswith("https://"):
        os.environ["DYNAMODB_ENDPOINT_URL"] = ""
    get_settings.cache_clear()
    try:
        from stocvest.data.watchlist_maturation_repository import (
            reset_watchlist_maturation_repository_for_tests,
        )

        reset_watchlist_maturation_repository_for_tests()
    except Exception:
        pass


@dataclass(frozen=True)
class CatchupJob:
    user_id: str
    symbol: str
    desk: Literal["day", "swing"]


@dataclass(frozen=True)
class StaleMaturationHint:
    user_id: str
    symbol: str
    desk: Literal["day", "swing"]
    state: str
    last_evaluated_at: str


def _today_et_iso() -> str:
    return datetime.now(_ET).date().isoformat()


def _parse_iso_date_prefix(raw: str | None) -> str | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return text[:10] if len(text) >= 10 else None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(_ET).date().isoformat()


def build_catchup_jobs(
    watchlist_rows: list[Any],
    *,
    sym_cap_for_user: Callable[[str], int],
    desk: CatchupDesk = "both",
) -> list[CatchupJob]:
    """Plan composite+sync jobs for default watchlists (deduped per user)."""
    seen_users: set[str] = set()
    jobs: list[CatchupJob] = []
    desks: tuple[Literal["day", "swing"], ...]
    if desk == "day":
        desks = ("day",)
    elif desk == "swing":
        desks = ("swing",)
    else:
        desks = ("day", "swing")

    for wl in watchlist_rows:
        if not getattr(wl, "is_default", False):
            continue
        uid = (getattr(wl, "user_id", None) or "").strip()
        if not uid or uid in seen_users:
            continue
        seen_users.add(uid)
        cap = max(0, int(sym_cap_for_user(uid)))
        symbols = [str(s).strip().upper() for s in (getattr(wl, "symbols", None) or []) if str(s).strip()]
        for sym in symbols[:cap]:
            for d in desks:
                jobs.append(CatchupJob(user_id=uid, symbol=sym, desk=d))
    return jobs


def find_stale_maturation_hints(
    repo: WatchlistMaturationRepository,
    jobs: list[CatchupJob],
    *,
    today_et: str | None = None,
) -> list[StaleMaturationHint]:
    """Rows that look stale (evaluated before today ET) or still marked actionable."""
    today = today_et or _today_et_iso()
    hints: list[StaleMaturationHint] = []
    seen: set[tuple[str, str, str]] = set()
    for job in jobs:
        key = (job.user_id, job.symbol, job.desk)
        if key in seen:
            continue
        seen.add(key)
        entry = repo.get_entry(job.user_id, job.symbol, job.desk)
        if entry is None:
            continue
        last_day = _parse_iso_date_prefix(entry.last_evaluated_at)
        stale = last_day is None or last_day < today
        actionable = entry.state == WatchlistState.ACTIONABLE
        if stale or actionable:
            hints.append(
                StaleMaturationHint(
                    user_id=job.user_id,
                    symbol=job.symbol,
                    desk=job.desk,
                    state=entry.state.value,
                    last_evaluated_at=entry.last_evaluated_at or "",
                )
            )
    return hints


def run_catchup_jobs(
    jobs: list[CatchupJob],
    *,
    max_calls: int,
    dry_run: bool,
) -> dict[str, Any]:
    """Run or preview catch-up composites + maturation sync."""
    planned = jobs[: max(0, max_calls)]
    if dry_run:
        return {
            "dry_run": True,
            "jobs_planned": len(planned),
            "jobs_total": len(jobs),
            "truncated": len(jobs) > len(planned),
        }

    day_ok = day_err = swing_ok = swing_err = 0
    written = skipped = failed = 0
    for job in planned:
        try:
            if job.desk == "day":
                body = real_composite_body_sync(symbol=job.symbol, user_id=job.user_id, user_email=None)
                status = sync_watchlist_maturation_from_composite(
                    user_id=job.user_id,
                    symbol=job.symbol,
                    mode="day",
                    composite_body=body,
                    email_on_state_change=False,
                    evaluation_source="maturation_refresh",
                )
                day_ok += 1
            else:
                body = swing_composite_body_sync(symbol=job.symbol, user_id=job.user_id, user_email=None)
                status = sync_watchlist_maturation_from_composite(
                    user_id=job.user_id,
                    symbol=job.symbol,
                    mode="swing",
                    composite_body=body,
                    email_on_state_change=False,
                    evaluation_source="maturation_refresh",
                )
                swing_ok += 1
            if status == "written":
                written += 1
            elif status in ("skipped_bad_body", "skipped_symbol_not_on_watchlist", "skipped_no_watchlist"):
                skipped += 1
            elif status == "failed_put":
                failed += 1
        except Exception:
            if job.desk == "day":
                day_err += 1
            else:
                swing_err += 1
    return {
        "dry_run": False,
        "jobs_run": len(planned),
        "jobs_total": len(jobs),
        "truncated": len(jobs) > len(planned),
        "written": written,
        "skipped": skipped,
        "failed_put": failed,
        "day": {"ok": day_ok, "errors": day_err},
        "swing": {"ok": swing_ok, "errors": swing_err},
    }


def _int_arg(raw: str, default: int) -> int:
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Catch up WatchlistMaturation rows for default watchlists (no SignalHistory changes)."
    )
    ap.add_argument("--dry-run", action="store_true", help="Report planned work only.")
    ap.add_argument("--execute", action="store_true", help="Run composites and upsert maturation rows.")
    ap.add_argument("--desk", choices=("day", "swing", "both"), default="both")
    ap.add_argument("--scan-limit", default="500", help="Max default watchlists to scan.")
    ap.add_argument("--max-calls", default="1500", help="Max composite+sync calls this run.")
    args = ap.parse_args()
    if args.dry_run == args.execute:
        ap.error("Specify exactly one of --dry-run or --execute")

    if args.execute and os.environ.get(_CONFIRM_ENV) != "yes":
        sys.stderr.write(f"Refusing to run: set {_CONFIRM_ENV}=yes to confirm.\n")
        return 1

    _sanitize_dynamodb_endpoint_env()
    repo = get_watchlist_maturation_repository()
    if repo is None:
        sys.stderr.write("DYNAMODB_WATCHLIST_MATURATION_TABLE is not configured.\n")
        return 1

    scan_limit = _int_arg(args.scan_limit, 500)
    max_calls = _int_arg(args.max_calls, 1500)
    desk: CatchupDesk = args.desk  # type: ignore[assignment]

    try:
        watchlists = get_watchlist_store().scan_default_watchlists(max(1, scan_limit))
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"watchlist scan failed: {exc}\n")
        return 1

    profile_store = get_user_profile_store()

    def _cap(uid: str) -> int:
        return watchlist_symbol_cap_for_profile(profile_store.get_profile(uid))

    jobs = build_catchup_jobs(watchlists, sym_cap_for_user=_cap, desk=desk)
    stale = find_stale_maturation_hints(repo, jobs)

    users = {j.user_id for j in jobs}
    print(f"Default watchlists scanned : {len(watchlists)}")
    print(f"Users with work            : {len(users)}")
    print(f"Catch-up jobs (total)      : {len(jobs)}")
    print(f"Catch-up jobs (this run)   : {min(len(jobs), max_calls)}")
    print(f"Desk filter                : {desk}")
    print(f"Stale/actionable hints     : {len(stale)}")

    for hint in stale[:25]:
        print(
            f"  stale user={hint.user_id[:8]}... sym={hint.symbol} desk={hint.desk} "
            f"state={hint.state} last={hint.last_evaluated_at or 'never'}"
        )
    if len(stale) > 25:
        print(f"  ... and {len(stale) - 25} more")

    result = run_catchup_jobs(jobs, max_calls=max_calls, dry_run=args.dry_run)
    if args.dry_run:
        print("\n[dry-run] No composites run; no maturation rows written.")
        if result.get("truncated"):
            print("Note: increase --max-calls to cover all jobs in one execute pass.")
        return 0

    print("\n[execute] Catch-up finished:")
    print(f"  written={result.get('written')} skipped={result.get('skipped')} failed_put={result.get('failed_put')}")
    print(f"  day={result.get('day')} swing={result.get('swing')}")
    if result.get("truncated"):
        print("Note: job list was truncated; re-run --execute to continue if needed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
