"""Phase 5e trade journal endpoint handlers."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, not_found, ok, unauthorized
from stocvest.api.services.journal_store import get_trade_journal_store
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import (
    DEFAULT_FREE_TEXT_MAX,
    SETUP_TYPE_MAX,
    SIGNAL_META_MAX,
    sanitize_free_text,
    sanitize_optional_free_text,
    sanitize_strategy_tags,
)
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.signals.trade_journal import (
    TradeJournalEntry,
    TradeJournalEntryStatus,
    TradeOpeningSide,
    compute_journal_analytics,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _entry_id_from_event(event: LambdaEvent) -> str | None:
    pp = event.get("pathParameters") or {}
    raw = pp.get("entry_id")
    if raw and not str(raw).startswith("{"):
        return str(raw).strip()
    rk = http_route_descriptor(event)
    for prefix in ("GET /v1/journal/entries/", "PATCH /v1/journal/entries/"):
        if rk.startswith(prefix):
            rest = rk[len(prefix) :].split("?")[0].strip()
            if rest and not rest.startswith("{"):
                return rest
    return None


def journal_list_entries_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    entries = get_trade_journal_store().entries_for_user(request_context.user_id)
    qs = event.get("queryStringParameters") or {}
    status_raw = str((qs or {}).get("status") or "all").strip().lower()
    limit_raw = (qs or {}).get("limit")
    try:
        limit = min(500, max(1, int(limit_raw or 100)))
    except (TypeError, ValueError):
        limit = 100
    if status_raw == "open":
        entries = tuple(e for e in entries if e.status == TradeJournalEntryStatus.OPEN)
    elif status_raw == "closed":
        entries = tuple(e for e in entries if e.status == TradeJournalEntryStatus.CLOSED)
    elif status_raw not in ("all", ""):
        return bad_request("status must be all, open, or closed.")
    entries = entries[:limit]
    return ok([_serialize_entry(entry) for entry in entries])


def journal_get_entry_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    eid = _entry_id_from_event(event)
    if not eid:
        return bad_request("entry_id is required.")
    entry = get_trade_journal_store().get_entry(request_context.user_id, eid)
    if entry is None:
        return not_found("Journal entry not found.")
    return ok(_serialize_entry(entry))


def journal_patch_entry_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    eid = _entry_id_from_event(event)
    if not eid:
        return bad_request("entry_id is required.")
    store = get_trade_journal_store()
    entry = store.get_entry(request_context.user_id, eid)
    if entry is None:
        return not_found("Journal entry not found.")
    try:
        payload = parse_json_body(event)
        notes = payload.get("notes")
        if notes is None:
            return bad_request("notes field is required.")
        cleaned = sanitize_free_text(notes, max_len=DEFAULT_FREE_TEXT_MAX)
        if not cleaned:
            return bad_request("notes must contain non-whitespace text.")
        updated = replace(entry, entry_notes=cleaned)
        store.replace_entry(updated)
        return ok(_serialize_entry(updated))
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid journal patch: {exc}")


def journal_analytics_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    entries = get_trade_journal_store().entries_for_user(request_context.user_id)
    analytics = compute_journal_analytics(entries, user_id=request_context.user_id, disclaimer=API_SIGNAL_DISCLAIMER)
    return ok(
        {
            "user_id": analytics.user_id,
            "total_trades": analytics.total_trades,
            "open_trades": analytics.open_trades,
            "win_rate": analytics.win_rate,
            "avg_winner_dollars": analytics.avg_winner_dollars,
            "avg_loser_dollars": analytics.avg_loser_dollars,
            "total_pnl_dollars": analytics.total_pnl_dollars,
            "expectancy": analytics.expectancy,
            "current_streak": analytics.current_streak,
            "best_setup_type": analytics.best_setup_type,
            "worst_setup_type": analytics.worst_setup_type,
            "best_setup_sample_size": analytics.best_setup_sample_size,
            "worst_setup_sample_size": analytics.worst_setup_sample_size,
            "disclaimer": analytics.disclaimer,
        }
    )


def journal_create_entry_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        entry = _parse_create_entry(payload, user_id=request_context.user_id)
        get_trade_journal_store().add(entry)
        if entry.is_day_trade:
            get_pdt_state_store().record_day_trade(entry.user_id, entry.opened_at.date())
        return ok(_serialize_entry(entry))
    except (ValueError, KeyError, TypeError) as exc:
        return bad_request(f"Invalid journal create request: {exc}")


def journal_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """Dispatch journal routes including path-parameter style (local dev + API Gateway)."""
    _ = context
    rk = http_route_descriptor(event)
    if rk == "GET /v1/journal/analytics" or rk.startswith("GET /v1/journal/analytics?"):
        return journal_analytics_handler(event, context)
    if rk == "POST /v1/journal/entries":
        return journal_create_entry_handler(event, context)
    if rk == "GET /v1/journal/entries" or rk.startswith("GET /v1/journal/entries?"):
        return journal_list_entries_handler(event, context)
    eid = _entry_id_from_event(event)
    if eid:
        if rk.upper().startswith("PATCH"):
            return journal_patch_entry_handler(event, context)
        if rk.upper().startswith("GET"):
            return journal_get_entry_handler(event, context)
    _LOG.warning("journal_dispatch unknown route: %s", rk)
    return not_found(f"Unknown journal route: {rk or '(empty)'}")


def _parse_create_entry(payload: dict[str, Any], *, user_id: str) -> TradeJournalEntry:
    if payload.get("user_id") is not None:
        raise ValueError("Do not submit user_id; identity is taken from your session.")
    opened_at_raw = payload.get("opened_at")
    if opened_at_raw is None:
        opened_at = datetime.now(timezone.utc)
    else:
        opened_at = datetime.fromisoformat(str(opened_at_raw))
        if opened_at.tzinfo is None:
            opened_at = opened_at.replace(tzinfo=timezone.utc)

    strategy_tags = sanitize_strategy_tags(payload.get("strategy_tags", []))
    broker_order_ids_raw = payload.get("broker_order_ids", [])
    broker_order_ids: tuple[str, ...] = ()
    if isinstance(broker_order_ids_raw, list):
        _oids: list[str] = []
        for x in broker_order_ids_raw[:32]:
            oid = sanitize_free_text(x, max_len=128)
            if oid:
                _oids.append(oid)
        broker_order_ids = tuple(_oids)

    sig_id = payload.get("signal_id")
    sig_dir = payload.get("signal_direction")
    sig_at = payload.get("signal_generated_at")
    ep = payload.get("entry_price_avg")
    setup_type_raw = payload.get("setup_type")
    setup_type = (
        sanitize_optional_free_text(setup_type_raw, max_len=SETUP_TYPE_MAX) if setup_type_raw is not None else None
    )
    entry_notes = (
        sanitize_optional_free_text(payload["entry_notes"], max_len=DEFAULT_FREE_TEXT_MAX)
        if payload.get("entry_notes") is not None
        else None
    )
    sig_id_s = sanitize_optional_free_text(sig_id, max_len=SIGNAL_META_MAX) if sig_id else None
    sig_dir_raw = sanitize_optional_free_text(sig_dir, max_len=64) if sig_dir else None
    sig_dir_s = sig_dir_raw.lower() if sig_dir_raw else None
    sig_at_s = sanitize_optional_free_text(sig_at, max_len=SIGNAL_META_MAX) if sig_at else None
    return TradeJournalEntry(
        entry_id=str(payload["entry_id"]),
        user_id=user_id,
        symbol=str(payload["symbol"]).upper(),
        opening_side=TradeOpeningSide(str(payload.get("opening_side", "buy"))),
        quantity=float(payload["quantity"]),
        opened_at=opened_at,
        status=TradeJournalEntryStatus.OPEN,
        strategy_tags=strategy_tags,
        is_day_trade=bool(payload.get("is_day_trade", False)),
        entry_notes=entry_notes,
        broker_order_ids=broker_order_ids,
        signal_id=sig_id_s,
        signal_direction=sig_dir_s,
        signal_generated_at=sig_at_s,
        entry_price_avg=float(ep) if ep is not None else None,
        setup_type=setup_type,
    )


def _serialize_entry(entry: TradeJournalEntry) -> dict[str, Any]:
    return {
        "entry_id": entry.entry_id,
        "user_id": entry.user_id,
        "symbol": entry.symbol,
        "opening_side": entry.opening_side.value,
        "quantity": entry.quantity,
        "opened_at": entry.opened_at.isoformat(),
        "status": entry.status.value,
        "strategy_tags": list(entry.strategy_tags),
        "is_day_trade": entry.is_day_trade,
        "entry_notes": entry.entry_notes,
        "closed_at": entry.closed_at.isoformat() if entry.closed_at else None,
        "exit_notes": entry.exit_notes,
        "pnl_realized_usd": entry.pnl_realized_usd,
        "broker_order_ids": list(entry.broker_order_ids),
        "signal_id": entry.signal_id,
        "signal_direction": entry.signal_direction,
        "signal_generated_at": entry.signal_generated_at,
        "entry_price_avg": entry.entry_price_avg,
        "exit_price_avg": entry.exit_price_avg,
        "exit_order_id": entry.exit_order_id,
        "broker": entry.broker,
        "account_id": entry.account_id,
        "setup_type": entry.setup_type,
        "signal_strength": entry.signal_strength,
        "confluence_score": entry.confluence_score,
        "outcome": entry.outcome,
        "pnl_percent": entry.pnl_percent,
        "hold_duration_minutes": entry.hold_duration_minutes,
    }
