"""Setup outcomes and system behavior analytics (B46)."""

from __future__ import annotations

from typing import Any

from stocvest.analytics.evolution_stats import filter_transitions_by_plan
from stocvest.analytics.system_metrics import aggregate_platform_behavior
from stocvest.analytics.outcome_stats import (
    aggregate_outcome_stats,
    build_outcome_events,
    filter_events_by_days,
)
from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, ok, unauthorized
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.watchlist_maturation_transition_repository import (
    get_watchlist_maturation_transition_repository,
    recorded_at_cutoff_iso,
)
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.models.watchlist import WatchlistMode
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


def _user_has_full_access(user_id: str) -> bool:
    store = get_user_profile_store()
    profile = store.get_profile(user_id) if store else None
    if profile is None:
        return False
    if profile.beta_access_active:
        return True
    plan = (profile.subscription_plan or "free").strip().lower()
    return plan in ("swing_pro", "swing_day_pro")


def _load_watchlist_transitions(
    user_id: str,
    symbols: list[str],
    mode: WatchlistMode,
    *,
    per_symbol_limit: int = 200,
) -> list[WatchlistMaturationTransition]:
    repo = get_watchlist_maturation_transition_repository()
    if repo is None:
        return []
    out: list[WatchlistMaturationTransition] = []
    for sym in symbols:
        su = sym.strip().upper()
        if not su:
            continue
        rows = repo.list_for_symbol(user_id, su, mode, limit=per_symbol_limit, scan_forward=True)
        out.extend(rows)
    return out


def analytics_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    route = http_route_descriptor(event)
    if route.startswith("GET /v1/analytics/setup-outcomes"):
        return analytics_setup_outcomes_handler(event, context)
    from stocvest.api.response import not_found

    return not_found(f"Unknown route: {route}")


def analytics_setup_outcomes_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/analytics/setup-outcomes — observational outcomes from maturation transitions."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")

    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}
    mode_raw = str(qs.get("mode") or "swing").strip().lower()
    mode: WatchlistMode = "swing" if mode_raw == "swing" else "day"
    try:
        days = int(qs.get("days") or 30)
    except (TypeError, ValueError):
        return bad_request("days must be an integer")
    days = max(1, min(days, 90))

    wl = get_watchlist_store().get_default_watchlist(rc.user_id)
    symbols = list(wl.symbols) if wl and wl.symbols else []
    has_full = _user_has_full_access(rc.user_id)
    all_transitions = _load_watchlist_transitions(rc.user_id, symbols, mode)
    filtered_trans = filter_transitions_by_plan(all_transitions, has_full_access=has_full)

    events = []
    by_sym: dict[str, list[WatchlistMaturationTransition]] = {}
    for t in filtered_trans:
        by_sym.setdefault(t.symbol.upper(), []).append(t)
    for sym, rows in by_sym.items():
        events.extend(build_outcome_events(sym, mode, rows))

    events = filter_events_by_days(events, days)
    events.sort(key=lambda e: e.session_date, reverse=True)
    cap = 200 if has_full else 40
    events = events[:cap]

    stats = aggregate_outcome_stats(events)
    return ok(
        {
            "mode": mode,
            "days": days,
            "has_full_access": has_full,
            "watchlist_symbol_count": len(symbols),
            "stats": stats,
            "events": [e.to_api_dict() for e in events],
            "disclaimer": (
                "Observational setup behavior on your watchlist — not trade performance, "
                "win rate, or investment advice."
            ),
        }
    )


def admin_system_behavior_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/admin/system-behavior — aggregate transition telemetry (admin)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    headers = event.get("headers") if isinstance(event.get("headers"), dict) else {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return unauthorized("Admin access required.")

    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}
    mode_raw = str(qs.get("mode") or "swing").strip().lower()
    mode: WatchlistMode = "swing" if mode_raw == "swing" else "day"
    try:
        days = int(qs.get("days") or 30)
    except (TypeError, ValueError):
        return bad_request("days must be an integer")
    days = max(1, min(days, 90))

    trans_repo = get_watchlist_maturation_transition_repository()
    transitions: list[WatchlistMaturationTransition] = []
    if trans_repo is not None:
        transitions = trans_repo.list_for_mode(
            mode,
            limit=3000,
            recorded_after=recorded_at_cutoff_iso(days),
            scan_forward=True,
        )

    payload = aggregate_platform_behavior(transitions, mode=mode, days=days)
    return ok(payload)
