"""Phase 5e trade journal endpoint handlers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from stocvest.api.response import bad_request, ok, unauthorized
from stocvest.api.services.journal_store import get_trade_journal_store
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.signals.trade_journal import TradeJournalEntry, TradeJournalEntryStatus, TradeOpeningSide

def journal_list_entries_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    entries = get_trade_journal_store().entries_for_user(request_context.user_id)
    return ok([_serialize_entry(entry) for entry in entries])


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


def _parse_create_entry(payload: dict[str, Any], *, user_id: str) -> TradeJournalEntry:
    opened_at_raw = payload.get("opened_at")
    if opened_at_raw is None:
        opened_at = datetime.now(timezone.utc)
    else:
        opened_at = datetime.fromisoformat(str(opened_at_raw))
        if opened_at.tzinfo is None:
            opened_at = opened_at.replace(tzinfo=timezone.utc)

    strategy_tags_raw = payload.get("strategy_tags", [])
    strategy_tags = tuple(str(x) for x in strategy_tags_raw) if isinstance(strategy_tags_raw, list) else ()
    broker_order_ids_raw = payload.get("broker_order_ids", [])
    broker_order_ids = (
        tuple(str(x) for x in broker_order_ids_raw) if isinstance(broker_order_ids_raw, list) else ()
    )

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
        entry_notes=str(payload["entry_notes"]) if payload.get("entry_notes") is not None else None,
        broker_order_ids=broker_order_ids,
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
    }
