"""Shared journal store for API handlers (DynamoDB-backed in non-dev)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from stocvest.signals.trade_journal import TradeJournal, TradeJournalEntry
from stocvest.utils.config import get_settings


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


class JournalStore(Protocol):
    def add(self, entry: TradeJournalEntry) -> None: ...
    def replace_entry(self, entry: TradeJournalEntry) -> None: ...
    def entries_for_user(self, user_id: str) -> tuple[TradeJournalEntry, ...]: ...
    def get_entry(self, user_id: str, entry_id: str) -> TradeJournalEntry | None: ...


@dataclass
class InMemoryJournalStore:
    journal: TradeJournal

    def add(self, entry: TradeJournalEntry) -> None:
        self.journal.add(entry)

    def replace_entry(self, entry: TradeJournalEntry) -> None:
        self.journal.replace_entry(entry)

    def entries_for_user(self, user_id: str) -> tuple[TradeJournalEntry, ...]:
        return self.journal.entries_for_user(user_id)

    def get_entry(self, user_id: str, entry_id: str) -> TradeJournalEntry | None:
        e = self.journal.get(entry_id)
        return e if e and e.user_id == user_id else None


@dataclass
class DynamoDBJournalStore:
    table: DynamoTableLike
    user_key: str = "userId"
    entries_key: str = "entries"

    @classmethod
    def from_boto3_table(
        cls,
        *,
        table_name: str,
        dynamodb_resource: Any = None,
        user_key: str = "userId",
        entries_key: str = "entries",
    ) -> "DynamoDBJournalStore":
        if dynamodb_resource is None:
            import boto3

            dynamodb_resource = boto3.resource("dynamodb")
        table = dynamodb_resource.Table(table_name)
        return cls(table=table, user_key=user_key, entries_key=entries_key)

    def add(self, entry: TradeJournalEntry) -> None:
        current = self.entries_for_user(entry.user_id)
        if any(x.entry_id == entry.entry_id for x in current):
            raise ValueError(f"Duplicate entry_id: {entry.entry_id}")
        rows = [x.to_dynamo_item() for x in current] + [entry.to_dynamo_item()]
        self.table.put_item(
            Item={
                self.user_key: entry.user_id,
                self.entries_key: rows,
            }
        )

    def replace_entry(self, entry: TradeJournalEntry) -> None:
        current = self.entries_for_user(entry.user_id)
        rows_out: list[dict[str, Any]] = []
        found = False
        for x in current:
            if x.entry_id == entry.entry_id:
                rows_out.append(entry.to_dynamo_item())
                found = True
            else:
                rows_out.append(x.to_dynamo_item())
        if not found:
            raise ValueError(f"Unknown entry_id: {entry.entry_id}")
        self.table.put_item(Item={self.user_key: entry.user_id, self.entries_key: rows_out})

    def get_entry(self, user_id: str, entry_id: str) -> TradeJournalEntry | None:
        for e in self.entries_for_user(user_id):
            if e.entry_id == entry_id:
                return e
        return None

    def entries_for_user(self, user_id: str) -> tuple[TradeJournalEntry, ...]:
        resp = self.table.get_item(Key={self.user_key: user_id})
        item = resp.get("Item")
        if not item:
            return ()
        rows = item.get(self.entries_key) or []
        entries = [TradeJournalEntry.from_dynamo_item(x) for x in rows if isinstance(x, dict)]
        entries.sort(key=lambda e: e.opened_at, reverse=True)
        return tuple(entries)


def build_default_journal_store() -> JournalStore:
    settings = get_settings()
    if settings.trade_journal_table:
        return DynamoDBJournalStore.from_boto3_table(table_name=settings.trade_journal_table)
    if settings.is_development:
        return InMemoryJournalStore(TradeJournal())
    raise ValueError(
        "STOCVEST_TRADE_JOURNAL_TABLE must be configured in non-development environments."
    )


_JOURNAL_STORE: JournalStore = build_default_journal_store()


def get_trade_journal_store() -> JournalStore:
    return _JOURNAL_STORE
