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
    entry_price_avg: float | None = None
    exit_price_avg: float | None = None
    exit_order_id: str | None = None
    broker: str | None = None
    account_id: str | None = None
    setup_type: str | None = None
    signal_strength: int | None = None
    confluence_score: int | None = None
    outcome: str | None = None
    pnl_percent: float | None = None
    hold_duration_minutes: int | None = None

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
        if self.entry_price_avg is not None:
            item["entryPriceAvg"] = self.entry_price_avg
        if self.exit_price_avg is not None:
            item["exitPriceAvg"] = self.exit_price_avg
        if self.exit_order_id:
            item["exitOrderId"] = self.exit_order_id
        if self.broker:
            item["broker"] = self.broker
        if self.account_id:
            item["accountId"] = self.account_id
        if self.setup_type:
            item["setupType"] = self.setup_type
        if self.signal_strength is not None:
            item["signalStrength"] = int(self.signal_strength)
        if self.confluence_score is not None:
            item["confluenceScore"] = int(self.confluence_score)
        if self.outcome:
            item["outcome"] = self.outcome
        if self.pnl_percent is not None:
            item["pnlPercent"] = self.pnl_percent
        if self.hold_duration_minutes is not None:
            item["holdDurationMinutes"] = int(self.hold_duration_minutes)
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
        ep = item.get("entryPriceAvg")
        xp = item.get("exitPriceAvg")
        xoid = item.get("exitOrderId")
        br = item.get("broker")
        aid = item.get("accountId")
        st = item.get("setupType")
        ss = item.get("signalStrength")
        cc = item.get("confluenceScore")
        oc = item.get("outcome")
        pp = item.get("pnlPercent")
        hm = item.get("holdDurationMinutes")
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
            entry_price_avg=float(ep) if ep is not None else None,
            exit_price_avg=float(xp) if xp is not None else None,
            exit_order_id=str(xoid) if xoid else None,
            broker=str(br) if br else None,
            account_id=str(aid) if aid else None,
            setup_type=str(st) if st else None,
            signal_strength=int(ss) if ss is not None else None,
            confluence_score=int(cc) if cc is not None else None,
            outcome=str(oc) if oc else None,
            pnl_percent=float(pp) if pp is not None else None,
            hold_duration_minutes=int(hm) if hm is not None else None,
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
        if entry.pnl_realized_usd is None:
            raise ValueError("closed trades require pnl_realized_usd")
    if entry.status == TradeJournalEntryStatus.OPEN:
        if entry.closed_at is not None:
            raise ValueError("open trades must not set closed_at")
        if entry.pnl_realized_usd is not None:
            raise ValueError("open trades must not set pnl_realized_usd")
        if entry.exit_price_avg is not None:
            raise ValueError("open trades must not set exit_price_avg")
    if entry.status == TradeJournalEntryStatus.CANCELLED:
        if entry.pnl_realized_usd is not None:
            raise ValueError("cancelled entries must not set pnl_realized_usd")
        if entry.closed_at is not None and entry.closed_at < entry.opened_at:
            raise ValueError("closed_at must be >= opened_at")


def _outcome_from_pnl(pnl: float) -> str:
    if abs(pnl) < 0.01:
        return "breakeven"
    return "win" if pnl > 0 else "loss"


def close_trade_journal_entry(
    entry: TradeJournalEntry,
    *,
    closed_at: datetime,
    exit_price_avg: float | None = None,
    exit_order_id: str | None = None,
    pnl_realized_usd: float | None = None,
    exit_notes: str | None = None,
) -> TradeJournalEntry:
    if entry.status != TradeJournalEntryStatus.OPEN:
        raise ValueError("Only OPEN entries can be closed.")
    if closed_at.tzinfo is None:
        closed_at = closed_at.replace(tzinfo=timezone.utc)

    pnl = pnl_realized_usd
    ep = entry.entry_price_avg
    xp = exit_price_avg
    q = float(entry.quantity)
    if pnl is None and ep is not None and xp is not None:
        if entry.opening_side == TradeOpeningSide.BUY:
            pnl = (xp - ep) * q
        else:
            pnl = (ep - xp) * q

    if pnl is None:
        raise ValueError("Close requires pnl_realized_usd or both entry and exit prices.")

    pnl_pct: float | None = None
    if ep is not None and ep > 0 and xp is not None:
        if entry.opening_side == TradeOpeningSide.BUY:
            pnl_pct = (xp - ep) / ep * 100.0
        else:
            pnl_pct = (ep - xp) / ep * 100.0

    hold_min = int((closed_at - entry.opened_at).total_seconds() / 60.0)

    updated = replace(
        entry,
        status=TradeJournalEntryStatus.CLOSED,
        closed_at=closed_at,
        exit_price_avg=xp,
        exit_order_id=exit_order_id.strip() if exit_order_id else entry.exit_order_id,
        pnl_realized_usd=float(pnl),
        exit_notes=exit_notes if exit_notes is not None else entry.exit_notes,
        outcome=_outcome_from_pnl(float(pnl)),
        pnl_percent=round(pnl_pct, 4) if pnl_pct is not None else None,
        hold_duration_minutes=hold_min,
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


@dataclass(frozen=True)
class JournalAnalytics:
    user_id: str
    total_trades: int
    open_trades: int
    win_rate: float
    avg_winner_dollars: float
    avg_loser_dollars: float
    total_pnl_dollars: float
    expectancy: float
    current_streak: int
    best_setup_type: str | None
    worst_setup_type: str | None
    best_setup_sample_size: int
    worst_setup_sample_size: int
    disclaimer: str


def compute_journal_analytics(entries: tuple[TradeJournalEntry, ...], *, user_id: str, disclaimer: str) -> JournalAnalytics:
    open_n = sum(1 for e in entries if e.status == TradeJournalEntryStatus.OPEN)
    closed = [e for e in entries if e.status == TradeJournalEntryStatus.CLOSED and e.pnl_realized_usd is not None]
    if not closed:
        return JournalAnalytics(
            user_id=user_id,
            total_trades=0,
            open_trades=open_n,
            win_rate=0.0,
            avg_winner_dollars=0.0,
            avg_loser_dollars=0.0,
            total_pnl_dollars=0.0,
            expectancy=0.0,
            current_streak=0,
            best_setup_type=None,
            worst_setup_type=None,
            best_setup_sample_size=0,
            worst_setup_sample_size=0,
            disclaimer=disclaimer,
        )

    winners = [e for e in closed if (e.pnl_realized_usd or 0) > 0]
    losers = [e for e in closed if (e.pnl_realized_usd or 0) < 0]
    breakeven = [e for e in closed if abs(e.pnl_realized_usd or 0) < 0.01]
    n_decisive = len(winners) + len(losers)
    win_rate = len(winners) / n_decisive if n_decisive else 0.0
    avg_winner = sum(e.pnl_realized_usd or 0 for e in winners) / len(winners) if winners else 0.0
    avg_loser_mag = sum(abs(e.pnl_realized_usd or 0) for e in losers) / len(losers) if losers else 0.0
    loss_rate = 1.0 - win_rate if n_decisive else 0.0
    expectancy = (win_rate * avg_winner) - (loss_rate * avg_loser_mag)
    total_pnl = sum(e.pnl_realized_usd or 0 for e in closed)

    ordered = sorted(
        [e for e in closed if e.closed_at is not None],
        key=lambda e: e.closed_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    streak = 0
    for e in ordered:
        o = e.outcome or _outcome_from_pnl(float(e.pnl_realized_usd or 0))
        if o == "breakeven":
            break
        if o == "win":
            if streak >= 0:
                streak += 1
            else:
                break
        elif o == "loss":
            if streak <= 0:
                streak -= 1
            else:
                break

    setup_pnl: dict[str, list[float]] = {}
    for e in closed:
        st = e.setup_type or (e.strategy_tags[0] if e.strategy_tags else None)
        if not st:
            continue
        setup_pnl.setdefault(st, []).append(float(e.pnl_realized_usd or 0))
    setup_avg = {k: sum(v) / len(v) for k, v in setup_pnl.items() if len(v) >= 2}
    best_setup = max(setup_avg, key=setup_avg.get) if setup_avg else None
    worst_setup = min(setup_avg, key=setup_avg.get) if setup_avg else None
    best_n = len(setup_pnl.get(best_setup, [])) if best_setup else 0
    worst_n = len(setup_pnl.get(worst_setup, [])) if worst_setup else 0

    _ = breakeven  # reserved for future win-rate definitions including B/E

    return JournalAnalytics(
        user_id=user_id,
        total_trades=len(closed),
        open_trades=open_n,
        win_rate=round(win_rate, 4),
        avg_winner_dollars=round(avg_winner, 2),
        avg_loser_dollars=round(avg_loser_mag, 2),
        total_pnl_dollars=round(total_pnl, 2),
        expectancy=round(expectancy, 2),
        current_streak=streak,
        best_setup_type=best_setup,
        worst_setup_type=worst_setup,
        best_setup_sample_size=best_n,
        worst_setup_sample_size=worst_n,
        disclaimer=disclaimer,
    )
