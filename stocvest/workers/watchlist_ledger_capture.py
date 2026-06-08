"""Scheduled validation ledger capture — composites during ledger entry windows.

Runs day + swing composites for maturation-actionable and near-ready symbols so gate
evaluation happens inside ``validation_timing`` windows (not 8:15 / 4:30 maturation slots).
Shadow rows (``ledger_qualified=False``) are written when ``ledger_capture=True``.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.services.watchlist_plan_limits import watchlist_symbol_cap_for_profile
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.models.watchlist import (
    NEAR_READY_LAYER_COUNT,
    WatchlistMode,
    WatchlistState,
    derive_progress_band,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

LedgerCaptureDesk = Literal["day", "swing", "both"]

_DEFAULT_SCAN_LIMIT = 500
_DEFAULT_MAX_CALLS = 1500


def _int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _caps() -> tuple[int, int]:
    return (
        _int_env("STOCVEST_LEDGER_CAPTURE_SCAN_LIMIT", _DEFAULT_SCAN_LIMIT),
        _int_env("STOCVEST_LEDGER_CAPTURE_MAX_CALLS", _DEFAULT_MAX_CALLS),
    )


def _prioritized_symbols_for_user(
    user_id: str,
    mode: WatchlistMode,
    *,
    sym_cap: int,
    fallback_symbols: list[str],
) -> list[str]:
    """Actionable first, then near-ready (4/6), then remaining watchlist symbols."""
    repo = get_watchlist_maturation_repository()
    ordered: list[str] = []
    seen: set[str] = set()

    def add(sym: str) -> None:
        su = sym.strip().upper()
        if not su or su in seen:
            return
        seen.add(su)
        ordered.append(su)

    if repo is not None:
        for entry in repo.list_by_state(user_id, WatchlistState.ACTIONABLE, mode=mode):
            add(entry.symbol)
        for entry in repo.list_for_user(user_id, mode=mode):
            if derive_progress_band(entry.layers_aligned, state=entry.state) == "near_ready":
                add(entry.symbol)
    for sym in fallback_symbols:
        add(sym)
        if len(ordered) >= sym_cap:
            break
    return ordered[:sym_cap]


def run_watchlist_ledger_capture_sync(*, desk: LedgerCaptureDesk = "both") -> dict[str, Any]:
    """Evaluate ledger gates for prioritized watchlist symbols inside entry windows."""
    scan_limit, max_calls = _caps()
    profile_store = get_user_profile_store()

    try:
        rows = get_watchlist_store().scan_default_watchlists(max(1, scan_limit))
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("ledger capture: scan_default_watchlists failed: %s", exc)
        return {
            "job": "watchlist_ledger_capture",
            "error": "watchlist_scan_failed",
            "detail": str(exc)[:200],
        }

    seen_users: set[str] = set()
    work_by_user: dict[str, list[str]] = {}
    for wl in rows:
        if not wl.is_default:
            continue
        uid = (wl.user_id or "").strip()
        if not uid or uid in seen_users:
            continue
        seen_users.add(uid)
        sym_cap = watchlist_symbol_cap_for_profile(profile_store.get_profile(uid))
        work_by_user[uid] = list(wl.symbols or [])[:sym_cap]

    # Round-robin across users so call budget is not exhausted by the first N accounts.
    day_queue: list[tuple[str, str]] = []
    swing_queue: list[tuple[str, str]] = []
    for user_id, fallback in work_by_user.items():
        if desk in ("day", "both"):
            for sym in _prioritized_symbols_for_user(
                user_id, "day", sym_cap=len(fallback), fallback_symbols=fallback
            ):
                day_queue.append((user_id, sym))
        if desk in ("swing", "both"):
            for sym in _prioritized_symbols_for_user(
                user_id, "swing", sym_cap=len(fallback), fallback_symbols=fallback
            ):
                swing_queue.append((user_id, sym))

    # Round-robin per desk so early users do not consume the entire composite budget.
    def _round_robin_jobs(jobs: list[tuple[str, str]]) -> list[tuple[str, str]]:
        buckets: dict[str, list[str]] = {}
        for uid, sym in jobs:
            buckets.setdefault(uid, []).append(sym)
        order = list(buckets.keys())
        out_jobs: list[tuple[str, str]] = []
        while order:
            next_order: list[str] = []
            for uid in order:
                syms = buckets.get(uid) or []
                if syms:
                    out_jobs.append((uid, syms.pop(0)))
                    if syms:
                        next_order.append(uid)
            order = next_order
        return out_jobs

    calls = 0
    day_ok = 0
    day_err = 0
    swing_ok = 0
    swing_err = 0
    day_qualified = 0
    swing_qualified = 0
    users_touched: set[str] = set()

    # Interleave day and swing jobs so neither desk can starve the other. The
    # previous implementation drained the *entire* day queue before touching
    # swing; under the Lambda timeout the invocation died inside the day loop and
    # the swing loop never ran, so zero swing signals were ever captured. By
    # alternating desks, a timeout or call-budget cap truncates both desks evenly
    # rather than dropping one wholesale. (Production also schedules day and swing
    # as separate single-desk invocations — this interleave is defense-in-depth
    # for any combined ``desk="both"`` run, e.g. manual/admin triggers.)
    day_jobs = _round_robin_jobs(day_queue)
    swing_jobs = _round_robin_jobs(swing_queue)
    interleaved: list[tuple[str, str, str]] = []  # (desk, user_id, symbol)
    di = si = 0
    while di < len(day_jobs) or si < len(swing_jobs):
        if di < len(day_jobs):
            uid_d, sym_d = day_jobs[di]
            interleaved.append(("day", uid_d, sym_d))
            di += 1
        if si < len(swing_jobs):
            uid_s, sym_s = swing_jobs[si]
            interleaved.append(("swing", uid_s, sym_s))
            si += 1

    for desk_lit, user_id, sym in interleaved:
        if calls >= max_calls:
            break
        try:
            if desk_lit == "day":
                body = real_composite_body_sync(
                    symbol=sym,
                    user_id=user_id,
                    user_email=None,
                    ledger_capture=True,
                )
                if body.get("ledger_qualified"):
                    day_qualified += 1
                day_ok += 1
            else:
                body = swing_composite_body_sync(
                    symbol=sym,
                    user_id=user_id,
                    user_email=None,
                    ledger_capture=True,
                )
                if body.get("ledger_qualified"):
                    swing_qualified += 1
                swing_ok += 1
            users_touched.add(user_id)
        except Exception as exc:  # noqa: BLE001
            if desk_lit == "day":
                day_err += 1
            else:
                swing_err += 1
            _LOG.debug("ledger capture %s failed user=%s sym=%s: %s", desk_lit, user_id, sym, exc)
        calls += 1

    day_jobs_planned = len(day_queue)
    swing_jobs_planned = len(swing_queue)

    out: dict[str, Any] = {
        "job": "watchlist_ledger_capture",
        "desk": desk,
        "users_with_default_watchlist": len(seen_users),
        "users_evaluated": len(users_touched),
        "composite_calls": calls,
        "caps": {"scan_limit": scan_limit, "max_calls": max_calls},
        "coverage": {
            "day_jobs_planned": day_jobs_planned,
            "swing_jobs_planned": swing_jobs_planned,
            "call_budget_exhausted": calls >= max_calls,
            "note": (
                "Only default-watchlist users are scanned (max 500 watchlists per run). "
                "Symbols outside the default list or non-default-only accounts are not included."
            ),
        },
        "day": {"ok": day_ok, "errors": day_err, "ledger_qualified": day_qualified},
        "swing": {"ok": swing_ok, "errors": swing_err, "ledger_qualified": swing_qualified},
        "near_ready_layer_count": NEAR_READY_LAYER_COUNT,
    }
    _LOG.info(
        "watchlist ledger capture done desk=%s users=%s calls=%s day_q=%s swing_q=%s",
        desk,
        len(seen_users),
        calls,
        day_qualified,
        swing_qualified,
    )
    return out
