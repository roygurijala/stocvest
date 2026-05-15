"""Alert preferences + recent delivery history."""

from __future__ import annotations

from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, not_found, ok, unauthorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.alert_store import get_alert_store
from stocvest.data.models import AlertPreferences, AlertRecord, AlertType

_BOOL_KEYS = frozenset(
    {
        "email_enabled",
        "on_signal_fired",
        "on_confluence_alert",
        "on_pdt_warning",
        "on_pdt_blocked",
        "on_gap_detected",
        "on_watchlist_maturation",
        "watchlist_only",
        "quiet_hours_enabled",
    }
)


def _query_int(event: LambdaEvent, key: str, default: int) -> int:
    q = event.get("queryStringParameters") or {}
    if not isinstance(q, dict):
        return default
    raw = q.get(key)
    if raw is None:
        return default
    try:
        return max(1, min(50, int(str(raw))))
    except (TypeError, ValueError):
        return default


def _query_alert_type(event: LambdaEvent) -> AlertType | None:
    """Optional ``alert_type`` filter (enum value string). ``None`` = no filter."""
    q = event.get("queryStringParameters") or {}
    if not isinstance(q, dict):
        return None
    raw = (q.get("alert_type") or q.get("alertType") or "").strip()
    if not raw:
        return None
    try:
        return AlertType(raw)
    except ValueError:
        raise ValueError(f"Invalid alert_type: {raw!r}") from None


def _query_symbols_filter(event: LambdaEvent) -> frozenset[str] | None:
    """Optional comma-separated ticker filter (uppercased). Max 50 tokens; skips empty junk."""
    q = event.get("queryStringParameters") or {}
    if not isinstance(q, dict):
        return None
    raw = (q.get("symbols") or "").strip()
    if not raw:
        return None
    out: list[str] = []
    for part in raw.split(","):
        s = part.strip().upper()
        if not s or len(s) > 12:
            continue
        if not all(ch.isalnum() or ch in ".-" for ch in s):
            continue
        out.append(s)
        if len(out) >= 50:
            break
    return frozenset(out) if out else None


def _prefs_from_body(user_id: str, body: dict[str, Any]) -> AlertPreferences:
    cur = get_alert_store().get_preferences(user_id)
    data = cur.model_dump()
    for k, v in body.items():
        if k in _BOOL_KEYS and v is not None:
            data[k] = bool(v)
        if k in ("quiet_hours_start", "quiet_hours_end") and isinstance(v, str):
            data[k] = v.strip()[:5] if len(v.strip()) >= 4 else data[k]
    data["user_id"] = user_id
    return AlertPreferences.model_validate(data)


def _serialize_prefs(p: AlertPreferences) -> dict[str, Any]:
    return p.model_dump(mode="json")


def _serialize_record(r: AlertRecord) -> dict[str, Any]:
    d = r.model_dump(mode="json")
    d["alert_type"] = r.alert_type.value
    d["channel"] = r.channel.value
    d["status"] = r.status.value
    return d


def alerts_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    route = http_route_descriptor(event)
    if route.startswith("GET /v1/alerts/preferences"):
        return alerts_preferences_get_handler(event, context)
    if route.startswith("PATCH /v1/alerts/preferences"):
        return alerts_preferences_patch_handler(event, context)
    if route.startswith("GET /v1/alerts/history"):
        return alerts_history_get_handler(event, context)
    return not_found(f"Unknown alerts route: {route}.")


def alerts_preferences_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    prefs = get_alert_store().get_preferences(rc.user_id)
    return ok(_serialize_prefs(prefs))


def alerts_preferences_patch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    prefs = _prefs_from_body(rc.user_id, body)
    saved = get_alert_store().save_preferences(rc.user_id, prefs)
    return ok(_serialize_prefs(saved))


def alerts_history_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    limit = _query_int(event, "limit", 20)
    try:
        type_filter = _query_alert_type(event)
    except ValueError as exc:
        return bad_request(str(exc))
    sym_filter = _query_symbols_filter(event)
    need_wide_scan = type_filter is not None or sym_filter is not None
    # Match API contract §4.14: with any filter, scan up to 50 newest rows (small `limit`
    # alone must not shrink the scan window or matches below the top few rows are missed).
    fetch_cap = 50 if need_wide_scan else limit
    rows = get_alert_store().get_recent_alerts(rc.user_id, limit=fetch_cap)
    if type_filter is not None:
        rows = [r for r in rows if r.alert_type == type_filter]
    if sym_filter is not None:
        rows = [r for r in rows if r.symbol and r.symbol.upper() in sym_filter]
    rows = rows[:limit]
    return ok({"alerts": [_serialize_record(r) for r in rows]})
