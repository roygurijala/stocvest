"""Bounded batch refresh of watchlist maturation rows via real composite engines.

Invoked from the scanner Lambda on ``scan_type=maturation_refresh`` (EventBridge Scheduler).
Scans default watchlists, runs day (and optionally swing) composites per symbol, and
``sync_watchlist_maturation_from_composite`` — same path as View Evidence dual-write.

Hard caps keep the job within the scanner Lambda timeout alongside Polygon cost control.
"""

from __future__ import annotations

import os
from typing import Any

from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.api.services.watchlist_maturation_sync import sync_watchlist_maturation_from_composite
from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_MAX_USERS = 15
_DEFAULT_MAX_SYMBOLS_PER_USER = 4
_DEFAULT_MAX_COMPOSITE_CALLS = 24


def _int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _include_swing() -> bool:
    return (os.environ.get("STOCVEST_MATURATION_REFRESH_SWING") or "").strip() in ("1", "true", "yes")


def run_watchlist_maturation_refresh_sync() -> dict[str, Any]:
    """Refresh maturation for a bounded sample of default watchlists (day + optional swing)."""
    repo = get_watchlist_maturation_repository()
    if repo is None:
        _LOG.info("watchlist maturation refresh: skipped (DYNAMODB_WATCHLIST_MATURATION_TABLE unset)")
        return {
            "job": "watchlist_maturation_refresh",
            "skipped": True,
            "reason": "maturation_table_unconfigured",
        }

    max_users = _int_env("STOCVEST_MATURATION_REFRESH_MAX_USERS", _DEFAULT_MAX_USERS)
    max_sym = _int_env("STOCVEST_MATURATION_REFRESH_MAX_SYMBOLS_PER_USER", _DEFAULT_MAX_SYMBOLS_PER_USER)
    max_calls = _int_env("STOCVEST_MATURATION_REFRESH_MAX_CALLS", _DEFAULT_MAX_COMPOSITE_CALLS)
    include_swing = _include_swing()

    try:
        rows = get_watchlist_store().scan_default_watchlists(max(1, max_users * 2))
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("watchlist maturation refresh: scan_default_watchlists failed: %s", exc)
        return {"job": "watchlist_maturation_refresh", "error": "watchlist_scan_failed", "detail": str(exc)[:200]}

    # One default list per user in scan order; cap distinct users.
    seen_users: set[str] = set()
    work: list[tuple[str, str]] = []
    for wl in rows:
        if not wl.is_default:
            continue
        uid = (wl.user_id or "").strip()
        if not uid or uid in seen_users:
            continue
        seen_users.add(uid)
        for sym in (wl.symbols or [])[:max_sym]:
            su = str(sym).strip().upper()
            if su:
                work.append((uid, su))
        if len(seen_users) >= max_users:
            break

    calls = 0
    day_ok = 0
    day_err = 0
    swing_ok = 0
    swing_err = 0

    for user_id, sym in work:
        if calls >= max_calls:
            break
        try:
            body = real_composite_body_sync(symbol=sym, user_id=user_id, user_email=None)
            sync_watchlist_maturation_from_composite(
                user_id=user_id,
                symbol=sym,
                mode="day",
                composite_body=body,
                email_on_state_change=False,
            )
            day_ok += 1
        except Exception as exc:  # noqa: BLE001
            day_err += 1
            _LOG.debug("maturation refresh day failed user=%s sym=%s: %s", user_id, sym, exc)
        calls += 1

        if include_swing and calls < max_calls:
            try:
                body_s = swing_composite_body_sync(symbol=sym, user_id=user_id, user_email=None)
                sync_watchlist_maturation_from_composite(
                    user_id=user_id,
                    symbol=sym,
                    mode="swing",
                    composite_body=body_s,
                    email_on_state_change=False,
                )
                swing_ok += 1
            except Exception as exc:  # noqa: BLE001
                swing_err += 1
                _LOG.debug("maturation refresh swing failed user=%s sym=%s: %s", user_id, sym, exc)
            calls += 1

    out: dict[str, Any] = {
        "job": "watchlist_maturation_refresh",
        "users_considered": len(seen_users),
        "symbol_slots": len(work),
        "composite_calls": calls,
        "day": {"ok": day_ok, "errors": day_err},
        "include_swing": include_swing,
    }
    if include_swing:
        out["swing"] = {"ok": swing_ok, "errors": swing_err}
    _LOG.info(
        "watchlist maturation refresh done users=%s calls=%s day_ok=%s day_err=%s swing=%s",
        len(seen_users),
        calls,
        day_ok,
        day_err,
        include_swing,
    )
    return out
