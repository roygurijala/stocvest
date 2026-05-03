"""Watchlist CRUD + default symbols for scanner / brief."""

from __future__ import annotations

from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, json_response, not_found, ok, unauthorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import WATCHLIST_NAME_MAX, sanitize_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS
from stocvest.data.watchlist_store import WatchlistItem, get_watchlist_store
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
    if route.startswith("POST /v1/watchlists/default/symbols"):
        return watchlists_default_symbols_post_handler(event, context)
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
    try:
        out = get_watchlist_store().add_symbol(rc.user_id, wid, sym)
    except ValueError as exc:
        return json_response(400, {"error": "symbol_limit", "message": str(exc)})
    if out is None:
        return not_found("Watchlist not found.")
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


def watchlists_default_symbols_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    wl = get_watchlist_store().get_default_watchlist(rc.user_id)
    if wl and wl.symbols:
        return ok({"symbols": list(wl.symbols), "watchlist_name": wl.name})
    return ok({"symbols": list(SYSTEM_DEFAULTS), "watchlist_name": "System defaults"})


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
    try:
        out = store.add_symbol(rc.user_id, wl.watchlist_id, sym)
    except ValueError as exc:
        return json_response(400, {"error": "symbol_limit", "message": str(exc)})
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
