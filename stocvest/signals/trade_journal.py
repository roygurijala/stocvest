"""
Phase 2.5i: Trade journal — per-user trade records for review and analytics.

Structured for persistence (e.g. DynamoDB) without coupling to boto3 here.
Do not log full entries in production log streams; treat as user-private data.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class TradeJournalEntryStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class TradeOpeningSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class TradeJournalEntry:
    entry_id: str
    user_id: str
    symbol: str
    opening_side: TradeOpeningSide
    quantity: float
    opened_at: datetime
    status: TradeJournalEntryStatus
    strategy_tags: tuple[str, ...] = ()
    is_day_trade: bool = False
    entry_notes: str | None = None
    closed_at: datetime | None = None
    exit_notes: str | None = None
    pnl_realized_usd: float | None = None
    broker_order_ids: tuple[str, ...] = ()
    signal_id: str | None = None
    signal_direction: str | None = None
    signal_generated_at: str | None = None

    def to_dynamo_item(self) -> dict[str, Any]:
        item: dict[str, Any] = {
            "entryId": self.entry_id,
            "userId": self.user_id,
            "symbol": self.symbol,
            "openingSide": self.opening_side.value,
            "quantity": self.quantity,
            "openedAt": self.opened_at.isoformat(),
            "status": self.status.value,
            "strategyTags": list(self.strategy_tags),
            "isDayTrade": self.is_day_trade,
            "brokerOrderIds": list(self.broker_order_ids),
        }
        if self.entry_notes is not None:
            item["entryNotes"] = self.entry_notes
        if self.closed_at is not None:
            item["closedAt"] = self.closed_at.isoformat()
        if self.exit_notes is not None:
            item["exitNotes"] = self.exit_notes
        if self.pnl_realized_usd is not None:
            item["pnlRealizedUsd"] = self.pnl_realized_usd
        if self.signal_id:
            item["signalId"] = self.signal_id
        if self.signal_direction:
            item["signalDirection"] = self.signal_direction
        if self.signal_generated_at:
            item["signalGeneratedAt"] = self.signal_generated_at
        return item

    @staticmethod
    def from_dynamo_item(item: dict[str, Any]) -> TradeJournalEntry:
        closed_raw = item.get("closedAt")
        closed_at = datetime.fromisoformat(str(closed_raw)) if closed_raw else None
        opened_raw = item.get("openedAt")
        if not opened_raw:
            raise ValueError("Dynamo item missing openedAt")
        opened_at = datetime.fromisoformat(str(opened_raw))
        if opened_at.tzinfo is None:
            opened_at = opened_at.replace(tzinfo=timezone.utc)
        if closed_at is not None and closed_at.tzinfo is None:
            closed_at = closed_at.replace(tzinfo=timezone.utc)

        pnl = item.get("pnlRealizedUsd")
        sid = item.get("signalId")
        sdir = item.get("signalDirection")
        sgen = item.get("signalGeneratedAt")
        return TradeJournalEntry(
            entry_id=str(item["entryId"]),
            user_id=str(item["userId"]),
            symbol=str(item["symbol"]).upper(),
            opening_side=TradeOpeningSide(str(item["openingSide"])),
            quantity=float(item["quantity"]),
            opened_at=opened_at,
            status=TradeJournalEntryStatus(str(item["status"])),
            strategy_tags=tuple(str(x) for x in (item.get("strategyTags") or [])),
            is_day_trade=bool(item.get("isDayTrade", False)),
            entry_notes=item.get("entryNotes"),
            closed_at=closed_at,
            exit_notes=item.get("exitNotes"),
            pnl_realized_usd=float(pnl) if pnl is not None else None,
            broker_order_ids=tuple(str(x) for x in (item.get("brokerOrderIds") or [])),
            signal_id=str(sid) if sid else None,
            signal_direction=str(sdir) if sdir else None,
            signal_generated_at=str(sgen) if sgen else None,
        )


def validate_trade_journal_entry(entry: TradeJournalEntry) -> None:
    if not entry.entry_id.strip():
        raise ValueError("entry_id must be non-empty")
    if not entry.user_id.strip():
        raise ValueError("user_id must be non-empty")
    if not entry.symbol.strip():
        raise ValueError("symbol must be non-empty")
    if entry.quantity <= 0:
        raise ValueError("quantity must be positive")
    if entry.status == TradeJournalEntryStatus.CLOSED:
        if entry.closed_at is None:
            raise ValueError("closed trades require closed_at")
        if entry.closed_at < entry.opened_at:
            raise ValueError("closed_at must be >= opened_at")
    if entry.status == TradeJournalEntryStatus.OPEN:
        if entry.closed_at is not None:
            raise ValueError("open trades must not set closed_at")
        if entry.pnl_realized_usd is not None:
            raise ValueError("open trades must not set pnl_realized_usd")
    if entry.status == TradeJournalEntryStatus.CANCELLED:
        if entry.pnl_realized_usd is not None:
            raise ValueError("cancelled entries must not set pnl_realized_usd")
        if entry.closed_at is not None and entry.closed_at < entry.opened_at:
            raise ValueError("closed_at must be >= opened_at")


def close_trade_journal_entry(
    entry: TradeJournalEntry,
    *,
    closed_at: datetime,
    pnl_realized_usd: float | None = None,
    exit_notes: str | None = None,
) -> TradeJournalEntry:
    if entry.status != TradeJournalEntryStatus.OPEN:
        raise ValueError("Only OPEN entries can be closed.")
    if closed_at.tzinfo is None:
        closed_at = closed_at.replace(tzinfo=timezone.utc)
    updated = replace(
        entry,
        status=TradeJournalEntryStatus.CLOSED,
        closed_at=closed_at,
        pnl_realized_usd=pnl_realized_usd,
        exit_notes=exit_notes,
    )
    validate_trade_journal_entry(updated)
    return updated


class TradeJournal:
    """In-memory journal (tests, local tools). Dynamo persistence is a separate layer."""

    def __init__(self) -> None:
        self._by_id: dict[str, TradeJournalEntry] = {}

    def add(self, entry: TradeJournalEntry) -> None:
        validate_trade_journal_entry(entry)
        if entry.entry_id in self._by_id:
            raise ValueError(f"Duplicate entry_id: {entry.entry_id}")
        self._by_id[entry.entry_id] = entry

    def get(self, entry_id: str) -> TradeJournalEntry | None:
        return self._by_id.get(entry_id)

    def replace_entry(self, entry: TradeJournalEntry) -> None:
        validate_trade_journal_entry(entry)
        if entry.entry_id not in self._by_id:
            raise ValueError(f"Unknown entry_id: {entry.entry_id}")
        self._by_id[entry.entry_id] = entry

    def entries_for_user(self, user_id: str) -> tuple[TradeJournalEntry, ...]:
        rows = [e for e in self._by_id.values() if e.user_id == user_id]
        rows.sort(key=lambda e: e.opened_at, reverse=True)
        return tuple(rows)
