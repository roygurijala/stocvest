"""One trial per verified phone — HMAC-keyed ledger."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class PhoneAlreadyClaimedError(Exception):
    """Another account already used this phone for a trial."""


@dataclass(frozen=True)
class PhoneLedgerEntry:
    phone_hmac: str
    user_id: str
    trial_started_at: str


class PhoneLedgerStore(Protocol):
    def get(self, phone_hmac: str) -> PhoneLedgerEntry | None: ...
    def put(self, entry: PhoneLedgerEntry) -> None: ...


@dataclass
class InMemoryPhoneLedgerStore:
    _entries: dict[str, PhoneLedgerEntry] = field(default_factory=dict)

    def get(self, phone_hmac: str) -> PhoneLedgerEntry | None:
        return self._entries.get(phone_hmac)

    def put(self, entry: PhoneLedgerEntry) -> None:
        self._entries[entry.phone_hmac] = entry


class DynamoTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class DynamoPhoneLedgerStore:
    table: DynamoTableLike
    pk_attr: str = "userId"

    def _key(self, phone_hmac: str) -> dict[str, str]:
        return {self.pk_attr: f"PHONE_LEDGER#{phone_hmac}"}

    def get(self, phone_hmac: str) -> PhoneLedgerEntry | None:
        resp = self.table.get_item(Key=self._key(phone_hmac))
        item = resp.get("Item") or {}
        if not item:
            return None
        return PhoneLedgerEntry(
            phone_hmac=phone_hmac,
            user_id=str(item.get("ownerUserId") or ""),
            trial_started_at=str(item.get("trialStartedAt") or ""),
        )

    def put(self, entry: PhoneLedgerEntry) -> None:
        self.table.put_item(
            Item={
                self.pk_attr: f"PHONE_LEDGER#{entry.phone_hmac}",
                "ownerUserId": entry.user_id,
                "trialStartedAt": entry.trial_started_at,
                "phoneHmac": entry.phone_hmac,
            }
        )


def assert_phone_available(phone_hmac: str, user_id: str, store: PhoneLedgerStore) -> None:
    existing = store.get(phone_hmac)
    if existing is None:
        return
    if existing.user_id == user_id:
        return
    raise PhoneAlreadyClaimedError("This phone number is already linked to another account.")


_LEDGER: PhoneLedgerStore | None = None


def get_phone_ledger_store() -> PhoneLedgerStore:
    global _LEDGER
    if _LEDGER is None:
        from stocvest.utils.config import get_settings

        settings = get_settings()
        table_name = (settings.dynamodb_users_table or "").strip()
        if table_name:
            import boto3

            table = boto3.resource("dynamodb").Table(table_name)
            _LEDGER = DynamoPhoneLedgerStore(table=table)
        else:
            _LEDGER = InMemoryPhoneLedgerStore()
    return _LEDGER


def reset_phone_ledger_store_for_tests() -> None:
    global _LEDGER
    _LEDGER = None
