"""Auto journal capture after broker order submit — must never raise into order flow."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from stocvest.api.services.journal_store import JournalStore, get_trade_journal_store
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.brokers.models import OrderAck, OrderSide, OrderType, PlaceOrderRequest
from stocvest.signals.trade_journal import (
    TradeJournalEntry,
    TradeJournalEntryStatus,
    TradeOpeningSide,
    close_trade_journal_entry,
)
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def _resolve_fill_price(adapter: Any, account_id: str, request: PlaceOrderRequest, ack: OrderAck) -> float | None:
    if ack.average_fill_price is not None and float(ack.average_fill_price) > 0:
        return float(ack.average_fill_price)
    try:
        st = await adapter.get_order(account_id, request.client_order_id)
        if st.average_fill_price is not None and float(st.average_fill_price) > 0:
            return float(st.average_fill_price)
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("journal fill price get_order failed: %s", exc)
    if request.order_type == OrderType.LIMIT and request.limit_price is not None and float(request.limit_price) > 0:
        return float(request.limit_price)
    return None


def _parse_signal_context(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return {}
    keys = ("signal_id", "signal_strength", "confluence_score", "pattern", "signal_direction")
    return {k: raw[k] for k in keys if raw.get(k) is not None}


def _most_recent_open(
    store: JournalStore,
    user_id: str,
    symbol: str,
    opening_side: TradeOpeningSide,
) -> TradeJournalEntry | None:
    sym = symbol.upper().strip()
    matches = [
        e
        for e in store.entries_for_user(user_id)
        if e.status == TradeJournalEntryStatus.OPEN and e.symbol == sym and e.opening_side == opening_side
    ]
    if not matches:
        return None
    matches.sort(key=lambda e: e.opened_at, reverse=True)
    return matches[0]


async def apply_journal_after_order_submit(
    *,
    user_id: str,
    broker: str,
    account_id: str,
    request: PlaceOrderRequest,
    ack: OrderAck,
    adapter: Any,
    signal_context: dict[str, Any] | None,
    is_day_trade: bool,
) -> None:
    try:
        store = get_trade_journal_store()
        fill_px = await _resolve_fill_price(adapter, account_id, request, ack)
        if fill_px is None or fill_px <= 0:
            _LOG.debug("journal skip: no fill price symbol=%s client_order=%s", request.symbol, request.client_order_id)
            return

        sig = _parse_signal_context(signal_context)
        setup_type = str(sig.get("pattern") or "").strip() or None
        pattern_tags = (setup_type,) if setup_type else ()
        exit_oid = str(ack.broker_order_id or request.client_order_id).strip()
        now = datetime.now(timezone.utc)
        oid = str(ack.broker_order_id or request.client_order_id).strip()

        if request.side == OrderSide.BUY:
            short_open = _most_recent_open(store, user_id, request.symbol, TradeOpeningSide.SELL)
            if short_open is not None:
                closed = close_trade_journal_entry(
                    short_open,
                    closed_at=now,
                    exit_price_avg=fill_px,
                    exit_order_id=exit_oid,
                )
                store.replace_entry(closed)
                _LOG.info(
                    "journal closed short entry_id=%s user=%s symbol=%s",
                    closed.entry_id,
                    user_ref_for_logs(user_id),
                    request.symbol,
                )
                return
            entry = TradeJournalEntry(
                entry_id=str(uuid.uuid4()),
                user_id=user_id,
                symbol=request.symbol.upper().strip(),
                opening_side=TradeOpeningSide.BUY,
                quantity=float(request.quantity),
                opened_at=now,
                status=TradeJournalEntryStatus.OPEN,
                strategy_tags=pattern_tags if pattern_tags else (),
                is_day_trade=is_day_trade,
                entry_notes=None,
                broker_order_ids=(oid,),
                signal_id=str(sig["signal_id"]).strip() if sig.get("signal_id") else None,
                signal_direction=str(sig["signal_direction"]).strip().lower() if sig.get("signal_direction") else None,
                signal_generated_at=None,
                entry_price_avg=fill_px,
                broker=broker,
                account_id=account_id,
                setup_type=setup_type,
                signal_strength=int(sig["signal_strength"]) if sig.get("signal_strength") is not None else None,
                confluence_score=int(sig["confluence_score"]) if sig.get("confluence_score") is not None else None,
            )
            store.add(entry)
            if is_day_trade:
                get_pdt_state_store().record_day_trade(user_id, now.date())
            _LOG.info(
                "journal open long entry_id=%s user=%s symbol=%s",
                entry.entry_id,
                user_ref_for_logs(user_id),
                request.symbol,
            )
            return

        # SELL
        long_open = _most_recent_open(store, user_id, request.symbol, TradeOpeningSide.BUY)
        if long_open is not None:
            closed = close_trade_journal_entry(
                long_open,
                closed_at=now,
                exit_price_avg=fill_px,
                exit_order_id=exit_oid,
            )
            store.replace_entry(closed)
            _LOG.info(
                "journal closed long entry_id=%s user=%s symbol=%s",
                closed.entry_id,
                user_ref_for_logs(user_id),
                request.symbol,
            )
            return

        entry = TradeJournalEntry(
            entry_id=str(uuid.uuid4()),
            user_id=user_id,
            symbol=request.symbol.upper().strip(),
            opening_side=TradeOpeningSide.SELL,
            quantity=float(request.quantity),
            opened_at=now,
            status=TradeJournalEntryStatus.OPEN,
            strategy_tags=pattern_tags if pattern_tags else (),
            is_day_trade=is_day_trade,
            entry_notes=None,
            broker_order_ids=(oid,),
            signal_id=str(sig["signal_id"]).strip() if sig.get("signal_id") else None,
            signal_direction=str(sig["signal_direction"]).strip().lower() if sig.get("signal_direction") else None,
            signal_generated_at=None,
            entry_price_avg=fill_px,
            broker=broker,
            account_id=account_id,
            setup_type=setup_type,
            signal_strength=int(sig["signal_strength"]) if sig.get("signal_strength") is not None else None,
            confluence_score=int(sig["confluence_score"]) if sig.get("confluence_score") is not None else None,
        )
        store.add(entry)
        if is_day_trade:
            get_pdt_state_store().record_day_trade(user_id, now.date())
        _LOG.info(
            "journal open short entry_id=%s user=%s symbol=%s",
            entry.entry_id,
            user_ref_for_logs(user_id),
            request.symbol,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.exception(
            "journal automation failed user=%s symbol=%s: %s",
            user_ref_for_logs(user_id),
            request.symbol,
            exc,
        )
