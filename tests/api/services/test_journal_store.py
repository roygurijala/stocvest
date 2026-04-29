from __future__ import annotations

import pytest

from stocvest.api.services.journal_store import (
    DynamoDBJournalStore,
    build_default_journal_store,
)
from stocvest.signals.trade_journal import (
    TradeJournalEntry,
    TradeJournalEntryStatus,
    TradeOpeningSide,
)
from stocvest.utils.config import get_settings
from datetime import datetime, timezone


class _FakeTable:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def get_item(self, *, Key: dict[str, str]) -> dict:
        row = self.rows.get(Key["userId"])
        return {"Item": row} if row else {}

    def put_item(self, *, Item: dict) -> dict:
        self.rows[Item["userId"]] = Item
        return {}


def _entry(entry_id: str, user_id: str = "u1") -> TradeJournalEntry:
    return TradeJournalEntry(
        entry_id=entry_id,
        user_id=user_id,
        symbol="AAPL",
        opening_side=TradeOpeningSide.BUY,
        quantity=1,
        opened_at=datetime(2026, 4, 29, 12, 0, tzinfo=timezone.utc),
        status=TradeJournalEntryStatus.OPEN,
    )


def test_dynamodb_journal_store_roundtrip_and_duplicate_guard() -> None:
    store = DynamoDBJournalStore(table=_FakeTable())
    store.add(_entry("e1"))
    rows = store.entries_for_user("u1")
    assert len(rows) == 1
    assert rows[0].entry_id == "e1"
    with pytest.raises(ValueError, match="Duplicate"):
        store.add(_entry("e1"))


def test_build_default_journal_store_requires_table_outside_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("STOCVEST_ENV", "production")
    monkeypatch.delenv("STOCVEST_TRADE_JOURNAL_TABLE", raising=False)
    get_settings.cache_clear()
    with pytest.raises(ValueError, match="STOCVEST_TRADE_JOURNAL_TABLE"):
        build_default_journal_store()
