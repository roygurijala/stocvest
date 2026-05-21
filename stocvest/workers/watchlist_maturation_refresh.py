"""Bounded batch refresh of watchlist maturation rows via real composite engines.

Invoked from the scanner Lambda on scheduled ``scan_type`` values (EventBridge Scheduler,
America/New_York). Uses the same composite + ``sync_watchlist_maturation_from_composite`` path
as View Evidence and the watchlist row Refresh button.

Slots:
  - ``swing_open`` — weekday ~8:15 AM ET (after price-cache warm); swing desk only.
  - ``day_open`` — weekday ~9:35 AM ET; day desk only while NYSE regular session is open.
  - ``eod`` — weekday ~4:30 PM ET; day + optional swing reconciliation after cash close.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.services.watchlist_plan_limits import watchlist_symbol_cap_for_profile
from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.api.services.watchlist_maturation_sync import sync_watchlist_maturation_from_composite
from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

MaturationRefreshSlot = Literal["swing_open", "day_open", "eod"]

# Per-run scan breadth and composite-call budget (symbols per user come from plan caps).
_SLOT_DEFAULT_CAPS: dict[MaturationRefreshSlot, tuple[int, int]] = {
    "swing_open": (500, 2500),
    "day_open": (500, 2500),
    "eod": (500, 1500),
}

_LEGACY_MAX_COMPOSITE_CALLS = 24


def _int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _caps_for_slot(slot: MaturationRefreshSlot) -> tuple[int, int]:
    scan_default, calls_default = _SLOT_DEFAULT_CAPS[slot]
    if slot == "eod":
        return (
            _int_env("STOCVEST_MATURATION_REFRESH_SCAN_LIMIT", scan_default),
            _int_env("STOCVEST_MATURATION_REFRESH_MAX_CALLS", calls_default or _LEGACY_MAX_COMPOSITE_CALLS),
        )
    prefix = "SWING_OPEN" if slot == "swing_open" else "DAY_OPEN"
    return (
        _int_env(f"STOCVEST_MATURATION_REFRESH_{prefix}_SCAN_LIMIT", scan_default),
        _int_env(f"STOCVEST_MATURATION_REFRESH_{prefix}_MAX_CALLS", calls_default),
    )


def _include_swing_eod() -> bool:
    return (os.environ.get("STOCVEST_MATURATION_REFRESH_SWING") or "").strip() in ("1", "true", "yes")


def _scan_type_to_slot(scan_type: str | None) -> MaturationRefreshSlot:
    if scan_type == "maturation_refresh_swing":
        return "swing_open"
    if scan_type == "maturation_refresh_day":
        return "day_open"
    return "eod"


def run_watchlist_maturation_refresh_sync(
    *,
    slot: MaturationRefreshSlot | None = None,
    scan_type: str | None = None,
) -> dict[str, Any]:
    """Refresh maturation for a bounded sample of default watchlists."""
    resolved_slot = slot or _scan_type_to_slot(scan_type)
    repo = get_watchlist_maturation_repository()
    if repo is None:
        _LOG.info(
            "watchlist maturation refresh: skipped slot=%s (DYNAMODB_WATCHLIST_MATURATION_TABLE unset)",
            resolved_slot,
        )
        return {
            "job": "watchlist_maturation_refresh",
            "slot": resolved_slot,
            "skipped": True,
            "reason": "maturation_table_unconfigured",
        }

    if resolved_slot == "day_open":
        try:
            market = fetch_composite_market_status_payload_sync()
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("watchlist maturation day_open: market status failed: %s", exc)
            market = {"is_market_open": False}
        if not market.get("is_market_open"):
            _LOG.info("watchlist maturation day_open: skipped (NYSE not in regular session)")
            return {
                "job": "watchlist_maturation_refresh",
                "slot": resolved_slot,
                "skipped": True,
                "reason": "market_not_open",
                "market_session": market.get("market_session"),
            }

    scan_limit, max_calls = _caps_for_slot(resolved_slot)
    include_swing_eod = resolved_slot == "eod" and _include_swing_eod()
    profile_store = get_user_profile_store()

    try:
        rows = get_watchlist_store().scan_default_watchlists(max(1, scan_limit))
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("watchlist maturation refresh: scan_default_watchlists failed: %s", exc)
        return {
            "job": "watchlist_maturation_refresh",
            "slot": resolved_slot,
            "error": "watchlist_scan_failed",
            "detail": str(exc)[:200],
        }

    seen_users: set[str] = set()
    work: list[tuple[str, str]] = []
    for wl in rows:
        if not wl.is_default:
            continue
        uid = (wl.user_id or "").strip()
        if not uid or uid in seen_users:
            continue
        seen_users.add(uid)
        sym_cap = watchlist_symbol_cap_for_profile(profile_store.get_profile(uid))
        for sym in (wl.symbols or [])[:sym_cap]:
            su = str(sym).strip().upper()
            if su:
                work.append((uid, sym))

    calls = 0
    day_ok = 0
    day_err = 0
    swing_ok = 0
    swing_err = 0

    for user_id, sym in work:
        if calls >= max_calls:
            break

        if resolved_slot == "swing_open":
            try:
                body_s = swing_composite_body_sync(symbol=sym, user_id=user_id, user_email=None)
                sync_watchlist_maturation_from_composite(
                    user_id=user_id,
                    symbol=sym,
                    mode="swing",
                    composite_body=body_s,
                    email_on_state_change=False,
                    evaluation_source="maturation_refresh",
                )
                swing_ok += 1
            except Exception as exc:  # noqa: BLE001
                swing_err += 1
                _LOG.debug(
                    "maturation refresh swing failed slot=%s user=%s sym=%s: %s",
                    resolved_slot,
                    user_id,
                    sym,
                    exc,
                )
            calls += 1
            continue

        if resolved_slot in ("day_open", "eod") and calls < max_calls:
            try:
                body = real_composite_body_sync(symbol=sym, user_id=user_id, user_email=None)
                sync_watchlist_maturation_from_composite(
                    user_id=user_id,
                    symbol=sym,
                    mode="day",
                    composite_body=body,
                    email_on_state_change=False,
                    evaluation_source="maturation_refresh",
                )
                day_ok += 1
            except Exception as exc:  # noqa: BLE001
                day_err += 1
                _LOG.debug(
                    "maturation refresh day failed slot=%s user=%s sym=%s: %s",
                    resolved_slot,
                    user_id,
                    sym,
                    exc,
                )
            calls += 1

        if resolved_slot == "eod" and include_swing_eod and calls < max_calls:
            try:
                body_s = swing_composite_body_sync(symbol=sym, user_id=user_id, user_email=None)
                sync_watchlist_maturation_from_composite(
                    user_id=user_id,
                    symbol=sym,
                    mode="swing",
                    composite_body=body_s,
                    email_on_state_change=False,
                    evaluation_source="maturation_refresh",
                )
                swing_ok += 1
            except Exception as exc:  # noqa: BLE001
                swing_err += 1
                _LOG.debug(
                    "maturation refresh swing failed slot=%s user=%s sym=%s: %s",
                    resolved_slot,
                    user_id,
                    sym,
                    exc,
                )
            calls += 1

    out: dict[str, Any] = {
        "job": "watchlist_maturation_refresh",
        "slot": resolved_slot,
        "users_considered": len(seen_users),
        "symbol_slots": len(work),
        "composite_calls": calls,
        "caps": {"scan_limit": scan_limit, "max_composite_calls": max_calls},
    }
    if resolved_slot in ("day_open", "eod"):
        out["day"] = {"ok": day_ok, "errors": day_err}
    if resolved_slot in ("swing_open", "eod"):
        out["swing"] = {"ok": swing_ok, "errors": swing_err}
    if resolved_slot == "eod":
        out["include_swing_eod"] = include_swing_eod
    _LOG.info(
        "watchlist maturation refresh done slot=%s users=%s calls=%s day_ok=%s swing_ok=%s",
        resolved_slot,
        len(seen_users),
        calls,
        day_ok,
        swing_ok,
    )
    return out
