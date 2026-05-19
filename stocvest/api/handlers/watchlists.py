"""Watchlist CRUD + default symbols for scanner / brief."""

from __future__ import annotations

from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, json_response, not_found, ok, unauthorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import WATCHLIST_NAME_MAX, sanitize_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.analytics.evolution_stats import compute_evolution_summary, filter_transitions_by_plan
from stocvest.api.services.watchlist_maturation_gates import maturation_summary_include_readiness_label
from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.data.watchlist_maturation_transition_repository import (
    get_watchlist_maturation_transition_repository,
)
from stocvest.data.watchlist_store import WatchlistItem, get_watchlist_store
from stocvest.models.watchlist import WatchlistEntry, WatchlistMode
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _path_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("pathParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _serialize(w: WatchlistItem) -> dict[str, Any]:
    return w.to_api_dict()


def watchlists_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    route = http_route_descriptor(event)
    method = route.split(" ", 1)[0] if " " in route else ""
    if route.startswith("GET /v1/watchlists/default/symbols"):
        return watchlists_default_symbols_get_handler(event, context)
    if route == "GET /v1/watchlists/maturation-summary":
        return watchlists_maturation_summary_handler(event, context)
    if route.startswith("GET /v1/watchlists/symbols/") and route.endswith("/setup-evolution"):
        return watchlists_setup_evolution_handler(event, context)
    if route.startswith("POST /v1/watchlists/default/symbols"):
        return watchlists_default_symbols_post_handler(event, context)
    if method == "PATCH" and "/symbols/" in route and route.endswith("/tracking"):
        return watchlists_symbol_tracking_patch_handler(event, context)
    if method == "DELETE" and "/symbols/" in route and route.startswith("DELETE /v1/watchlists/"):
        return watchlists_remove_symbol_handler(event, context)
    if method == "POST" and "/symbols" in route and route.startswith("POST /v1/watchlists/"):
        if not route.startswith("POST /v1/watchlists/default/symbols"):
            return watchlists_add_symbol_handler(event, context)
    if route == "GET /v1/watchlists":
        return watchlists_list_handler(event, context)
    if route == "POST /v1/watchlists":
        return watchlists_create_handler(event, context)
    if method == "GET" and route.startswith("GET /v1/watchlists/") and "symbols" not in route:
        return watchlists_get_one_handler(event, context)
    if method == "PATCH" and route.startswith("PATCH /v1/watchlists/"):
        return watchlists_patch_handler(event, context)
    if method == "DELETE" and route.startswith("DELETE /v1/watchlists/") and "/symbols" not in route:
        return watchlists_delete_handler(event, context)
    return not_found(f"Unknown watchlists route: {route}.")


def watchlists_list_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    rows = get_watchlist_store().get_watchlists(rc.user_id)
    return ok({"watchlists": [_serialize(w) for w in rows]})


def watchlists_create_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    name = sanitize_free_text(body.get("name") or "", max_len=WATCHLIST_NAME_MAX)
    if not name:
        return bad_request("name is required.")
    symbols_raw = body.get("symbols")
    symbols: list[str] = []
    if isinstance(symbols_raw, list):
        symbols = [str(s) for s in symbols_raw]
    is_default = bool(body.get("is_default"))
    store = get_watchlist_store()
    try:
        w = store.create_watchlist(rc.user_id, name, symbols, is_default=is_default)
    except ValueError as exc:
        return json_response(400, {"error": "watchlist_limit", "message": str(exc)})
    return ok(_serialize(w))


def watchlists_get_one_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wid = _watchlist_id_from_event(event)
    if not wid:
        return bad_request("watchlist_id is required.")
    for w in get_watchlist_store().get_watchlists(rc.user_id):
        if w.watchlist_id == wid:
            return ok(_serialize(w))
    return not_found("Watchlist not found.")


def watchlists_patch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wid = _watchlist_id_from_event(event)
    if not wid:
        return bad_request("watchlist_id is required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    name = body.get("name")
    symbols = body.get("symbols")
    is_default = body.get("is_default")
    name_clean = sanitize_free_text(name, max_len=WATCHLIST_NAME_MAX) if name is not None else None
    out = get_watchlist_store().update_watchlist(
        rc.user_id,
        wid,
        name=name_clean if name_clean else None,
        symbols=[str(s) for s in symbols] if isinstance(symbols, list) else None,
        is_default=bool(is_default) if is_default is not None else None,
    )
    if out is None:
        return not_found("Watchlist not found.")
    return ok(_serialize(out))


def watchlists_delete_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wid = _watchlist_id_from_event(event)
    if not wid:
        return bad_request("watchlist_id is required.")
    try:
        ok_del = get_watchlist_store().delete_watchlist(rc.user_id, wid)
    except ValueError as exc:
        return json_response(400, {"error": "watchlist_delete_blocked", "message": str(exc)})
    if not ok_del:
        return not_found("Watchlist not found.")
    return ok({"deleted": True})


def watchlists_add_symbol_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wid = _watchlist_id_from_event(event)
    if not wid:
        return bad_request("watchlist_id is required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    sym = str(body.get("symbol") or "").strip()
    if not sym:
        return bad_request("symbol is required.")
    track_swing = body.get("track_swing")
    track_day = body.get("track_day")
    swing = True if track_swing is None else bool(track_swing)
    day = True if track_day is None else bool(track_day)
    try:
        out = get_watchlist_store().add_symbol(rc.user_id, wid, sym, track_swing=swing, track_day=day)
    except ValueError as exc:
        msg = str(exc)
        if "desk" in msg.lower():
            return bad_request(msg)
        return json_response(400, {"error": "symbol_limit", "message": msg})
    if out is None:
        return not_found("Watchlist not found.")
    return ok(_serialize(out))


def watchlists_symbol_tracking_patch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    pp = _path_params(event)
    wid = str(pp.get("watchlist_id") or "").strip()
    sym = str(pp.get("symbol") or "").strip()
    if not wid or not sym:
        return bad_request("watchlist_id and symbol path parameters are required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    if "track_swing" not in body and "track_day" not in body:
        return bad_request("track_swing and/or track_day are required.")
    track_swing = bool(body.get("track_swing", False))
    track_day = bool(body.get("track_day", False))
    try:
        out = get_watchlist_store().set_symbol_tracking(
            rc.user_id, wid, sym, track_swing=track_swing, track_day=track_day
        )
    except ValueError as exc:
        return bad_request(str(exc))
    if out is None:
        return not_found("Watchlist or symbol not found.")
    return ok(_serialize(out))


def watchlists_remove_symbol_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    pp = _path_params(event)
    wid = str(pp.get("watchlist_id") or "").strip()
    sym = str(pp.get("symbol") or "").strip().upper()
    if not wid or not sym:
        return bad_request("watchlist_id and symbol path parameters are required.")
    out = get_watchlist_store().remove_symbol(rc.user_id, wid, sym)
    if out is None:
        return not_found("Watchlist not found.")
    return ok(_serialize(out))


def watchlists_maturation_summary_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/watchlists/maturation-summary — default-list symbols only; ``mode=day|swing`` (default day).

    Response rows always include ``state`` and ``label``. ``readiness_label`` is included only for paid
    plans (``swing_pro``, ``swing_day_pro``) or when ``beta_access_active`` on the user's profile.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}
    mode_raw = str(qs.get("mode") or "day").strip().lower()
    mode: WatchlistMode = "swing" if mode_raw == "swing" else "day"

    try:
        repo = get_watchlist_maturation_repository()
        if repo is None:
            return ok(
                {
                    "mode": mode,
                    "by_symbol": {},
                    "storage_ready": False,
                    "watchlist_symbol_count": 0,
                }
            )

        wl = get_watchlist_store().get_default_watchlist(rc.user_id)
        if not wl or not wl.symbols:
            return ok(
                {
                    "mode": mode,
                    "by_symbol": {},
                    "storage_ready": True,
                    "watchlist_symbol_count": 0,
                }
            )

        allowed = [s.strip().upper() for s in wl.symbols if str(s).strip()]
        allowed_set = set(allowed)
        # Point reads per watchlist symbol (avoids scanning the full user partition).
        entries: list[WatchlistEntry] = []
        for sym in allowed:
            try:
                hit = repo.get_entry(rc.user_id, sym, mode)
            except Exception as exc:
                _LOG.warning("maturation_summary get_entry failed user=%s symbol=%s: %s", rc.user_id, sym, exc)
                continue
            if hit is not None and not hit.should_exclude_from_active_queries():
                entries.append(hit)
        profile = get_user_profile_store().get_profile(rc.user_id)
        include_readiness = maturation_summary_include_readiness_label(profile)
        trans_repo = get_watchlist_maturation_transition_repository()
        by_symbol: dict[str, dict[str, str | int | float | list[str]]] = {}
        for e in entries:
            try:
                su = e.symbol.strip().upper()
                if su not in allowed_set:
                    continue
                row: dict[str, str | int | float | list[str]] = {
                    "state": e.state.value,
                    "label": e.label,
                    "layers_aligned": e.layers_aligned,
                    "layers_total": e.layers_total,
                    "last_evaluated_at": e.last_evaluated_at,
                    "missing_layers": list(e.missing_layers),
                    "bias": e.bias,
                }
                if include_readiness:
                    row["readiness_label"] = e.readiness_label
                if trans_repo is not None:
                    try:
                        latest = trans_repo.latest_for_symbol(rc.user_id, su, mode)
                    except Exception as exc:
                        _LOG.warning(
                            "maturation_summary transition lookup failed user=%s symbol=%s mode=%s: %s",
                            rc.user_id,
                            su,
                            mode,
                            exc,
                        )
                        latest = None
                    if (
                        latest is not None
                        and latest.layers_aligned == e.layers_aligned
                        and latest.transition_type in ("improved", "worsened")
                        and latest.previous_layers_aligned is not None
                    ):
                        row["previous_layers_aligned"] = latest.previous_layers_aligned
                        row["last_transition_type"] = latest.transition_type
                by_symbol[su] = row
            except Exception as exc:
                _LOG.warning(
                    "maturation_summary skip bad entry user=%s symbol=%s: %s",
                    rc.user_id,
                    getattr(e, "symbol", "?"),
                    exc,
                )
        return ok(
            {
                "mode": mode,
                "by_symbol": by_symbol,
                "storage_ready": True,
                "watchlist_symbol_count": len(allowed),
            }
        )
    except Exception as exc:
        _LOG.exception("maturation_summary_failed user=%s mode=%s", rc.user_id, mode)
        return ok(
            {
                "mode": mode,
                "by_symbol": {},
                "degraded": True,
                "storage_ready": False,
                "watchlist_symbol_count": 0,
            }
        )


def watchlists_setup_evolution_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/watchlists/symbols/{symbol}/setup-evolution — transition timeline for default-list symbol."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    params = _path_params(event)
    sym = str(params.get("symbol") or "").strip().upper()
    if not sym:
        return bad_request("symbol path parameter is required.")
    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}
    mode_raw = str(qs.get("mode") or "swing").strip().lower()
    mode: WatchlistMode = "swing" if mode_raw == "swing" else "day"
    limit_raw = qs.get("limit")
    try:
        limit = int(limit_raw) if limit_raw is not None else 120
    except (TypeError, ValueError):
        return bad_request("limit must be an integer")
    limit = max(1, min(limit, 500))

    wl = get_watchlist_store().get_default_watchlist(rc.user_id)
    if not wl or sym not in {s.strip().upper() for s in wl.symbols}:
        return not_found("Symbol is not on your default watchlist.")

    mat_repo = get_watchlist_maturation_repository()
    started_tracking_at: str | None = None
    if mat_repo is not None:
        entry = mat_repo.get_entry(rc.user_id, sym, mode)
        if entry and entry.added_at:
            started_tracking_at = entry.added_at

    trans_repo = get_watchlist_maturation_transition_repository()
    raw_rows = []
    if trans_repo is not None:
        raw_rows = trans_repo.list_for_symbol(rc.user_id, sym, mode, limit=limit, scan_forward=True)

    profile_store = get_user_profile_store()
    profile = profile_store.get_profile(rc.user_id) if profile_store else None
    has_full = bool(profile and (profile.beta_access_active or (profile.subscription_plan or "").lower() in ("swing_pro", "swing_day_pro")))
    gated = filter_transitions_by_plan(raw_rows, has_full_access=has_full)
    transitions = [r.to_api_dict() for r in gated]
    summary = compute_evolution_summary(gated)

    return ok(
        {
            "symbol": sym,
            "mode": mode,
            "started_tracking_at": started_tracking_at,
            "has_full_access": has_full,
            "evaluation_cadence": (
                "Recorded when you view Evidence and on weekday maturation refresh (~4:30 PM ET after cash close)."
            ),
            "summary": summary,
            "transitions": transitions,
        }
    )


def watchlists_default_symbols_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wl = get_watchlist_store().get_default_watchlist(rc.user_id)
    if wl and wl.symbols:
        tracking = {s: wl.tracking_for_symbol(s) for s in wl.symbols}
        return ok({"symbols": list(wl.symbols), "watchlist_name": wl.name, "symbol_tracking": tracking})
    return ok({"symbols": list(SYSTEM_DEFAULTS), "watchlist_name": "System defaults", "symbol_tracking": {}})


def watchlists_default_symbols_post_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    sym = str(body.get("symbol") or "").strip()
    if not sym:
        return bad_request("symbol is required.")
    store = get_watchlist_store()
    wl = store.get_default_watchlist(rc.user_id)
    if wl is None:
        wl = store.create_watchlist(rc.user_id, "My Watchlist", [], is_default=True)
    track_swing = body.get("track_swing")
    track_day = body.get("track_day")
    swing = True if track_swing is None else bool(track_swing)
    day = True if track_day is None else bool(track_day)
    try:
        out = store.add_symbol(rc.user_id, wl.watchlist_id, sym, track_swing=swing, track_day=day)
    except ValueError as exc:
        msg = str(exc)
        if "desk" in msg.lower():
            return bad_request(msg)
        return json_response(400, {"error": "symbol_limit", "message": msg})
    if out is None:
        return not_found("Watchlist not found.")
    return ok(_serialize(out))


def _watchlist_id_from_event(event: LambdaEvent) -> str | None:
    pp = _path_params(event)
    raw = pp.get("watchlist_id")
    if raw and not str(raw).startswith("{"):
        return str(raw).strip()
    rk = http_route_descriptor(event)
    for prefix in ("GET /v1/watchlists/", "PATCH /v1/watchlists/", "DELETE /v1/watchlists/", "POST /v1/watchlists/"):
        if rk.startswith(prefix) and "default" not in rk:
            rest = rk[len(prefix) :].split("?")[0]
            if "/symbols" in rest:
                rest = rest.split("/symbols")[0]
            if rest and not rest.startswith("{") and rest != "default":
                return rest.strip()
    return None
