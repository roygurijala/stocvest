from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.signals.trade_journal import (
    TradeJournal,
    TradeJournalEntry,
    TradeJournalEntryStatus,
    TradeOpeningSide,
    close_trade_journal_entry,
    validate_trade_journal_entry,
)


def open_entry(**kwargs) -> TradeJournalEntry:
    defaults = dict(
        entry_id="e1",
        user_id="u1",
        symbol="AAPL",
        opening_side=TradeOpeningSide.BUY,
        quantity=10.0,
        opened_at=datetime(2026, 4, 28, 14, 30, tzinfo=timezone.utc),
        status=TradeJournalEntryStatus.OPEN,
        strategy_tags=(),
        is_day_trade=False,
        entry_notes=None,
        closed_at=None,
        exit_notes=None,
        pnl_realized_usd=None,
        broker_order_ids=(),
    )
    defaults.update(kwargs)
    return TradeJournalEntry(**defaults)


@pytest.mark.unit
def test_dynamo_roundtrip():
    e = open_entry(
        strategy_tags=("orb", "vwap"),
        is_day_trade=True,
        entry_notes="Setup from scanner",
        broker_order_ids=("oid-1",),
    )
    restored = TradeJournalEntry.from_dynamo_item(e.to_dynamo_item())
    assert restored == e


@pytest.mark.unit
def test_journal_add_and_list_by_user():
    j = TradeJournal()
    a = open_entry(entry_id="a", user_id="u1", opened_at=datetime(2026, 4, 28, 15, 0, tzinfo=timezone.utc))
    b = open_entry(entry_id="b", user_id="u1", opened_at=datetime(2026, 4, 28, 14, 0, tzinfo=timezone.utc))
    c = open_entry(entry_id="c", user_id="u2")
    j.add(a)
    j.add(b)
    j.add(c)
    u1 = j.entries_for_user("u1")
    assert [x.entry_id for x in u1] == ["a", "b"]


@pytest.mark.unit
def test_duplicate_entry_id_raises():
    j = TradeJournal()
    j.add(open_entry())
    with pytest.raises(ValueError, match="Duplicate"):
        j.add(open_entry(entry_notes="other"))


@pytest.mark.unit
def test_close_entry():
    e = open_entry()
    closed = close_trade_journal_entry(
        e,
        closed_at=e.opened_at + timedelta(hours=1),
        pnl_realized_usd=42.5,
        exit_notes="Target hit",
    )
    assert closed.status == TradeJournalEntryStatus.CLOSED
    assert closed.pnl_realized_usd == pytest.approx(42.5)


@pytest.mark.unit
def test_validation_rejects_bad_quantity():
    with pytest.raises(ValueError, match="quantity"):
        validate_trade_journal_entry(open_entry(quantity=0))


@pytest.mark.unit
def test_validation_open_must_not_have_closed_fields():
    bad = open_entry(closed_at=datetime(2026, 4, 28, 16, 0, tzinfo=timezone.utc))
    with pytest.raises(ValueError, match="open trades"):
        validate_trade_journal_entry(bad)


@pytest.mark.unit
def test_cancelled_entry_rejects_pnl():
    cancelled = open_entry(
        status=TradeJournalEntryStatus.CANCELLED,
        closed_at=datetime(2026, 4, 28, 15, 0, tzinfo=timezone.utc),
        pnl_realized_usd=1.0,
    )
    with pytest.raises(ValueError, match="cancelled"):
        validate_trade_journal_entry(cancelled)


@pytest.mark.unit
def test_replace_entry_updates_journal():
    j = TradeJournal()
    j.add(open_entry())
    closed = close_trade_journal_entry(
        j.get("e1"),
        closed_at=datetime(2026, 4, 28, 16, 0, tzinfo=timezone.utc),
        pnl_realized_usd=-10.0,
    )
    j.replace_entry(closed)
    assert j.get("e1").status == TradeJournalEntryStatus.CLOSED
