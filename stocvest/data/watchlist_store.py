"""DynamoDB-backed watchlists (PK userId, SK watchlistId) with optional in-memory store for tests."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_MAX_WATCHLISTS = 5
_MAX_SYMBOLS = 50


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_symbol(sym: str) -> str:
    s = str(sym or "").strip().upper()
    if not s or len(s) > 10:
        raise ValueError("symbol must be 1–10 uppercase characters")
    if not s.isalnum():
        raise ValueError("symbol must be alphanumeric")
    return s


@dataclass
class WatchlistItem:
    user_id: str
    watchlist_id: str
    name: str
    symbols: list[str]
    is_default: bool
    created_at: str
    updated_at: str

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "watchlist_id": self.watchlist_id,
            "user_id": self.user_id,
            "name": self.name,
            "symbols": list(self.symbols),
            "is_default": self.is_default,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_item(cls, user_id: str, item: dict[str, Any]) -> WatchlistItem:
        syms = item.get("symbols") or []
        if isinstance(syms, str):
            try:
                syms = json.loads(syms)
            except json.JSONDecodeError:
                syms = []
        if not isinstance(syms, list):
            syms = []
        symbols = [str(s).strip().upper() for s in syms if str(s).strip()]
        return cls(
            user_id=user_id,
            watchlist_id=str(item.get("watchlistId") or ""),
            name=str(item.get("name") or "Watchlist"),
            symbols=symbols,
            is_default=bool(item.get("isDefault")),
            created_at=str(item.get("createdAt") or ""),
            updated_at=str(item.get("updatedAt") or ""),
        )


class WatchlistStore(Protocol):
    def get_watchlists(self, user_id: str) -> list[WatchlistItem]: ...
    def get_default_watchlist(self, user_id: str) -> WatchlistItem | None: ...
    def create_watchlist(
        self, user_id: str, name: str, symbols: list[str], *, is_default: bool = False
    ) -> WatchlistItem: ...
    def update_watchlist(
        self,
        user_id: str,
        watchlist_id: str,
        *,
        name: str | None = None,
        symbols: list[str] | None = None,
        is_default: bool | None = None,
    ) -> WatchlistItem | None: ...
    def delete_watchlist(self, user_id: str, watchlist_id: str) -> bool: ...
    def add_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None: ...
    def remove_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None: ...


@dataclass
class InMemoryWatchlistStore:
    _by_user: dict[str, dict[str, WatchlistItem]] = field(default_factory=dict)

    def get_watchlists(self, user_id: str) -> list[WatchlistItem]:
        rows = list(self._by_user.get(user_id, {}).values())
        return sorted(rows, key=lambda w: (not w.is_default, w.created_at))

    def get_default_watchlist(self, user_id: str) -> WatchlistItem | None:
        rows = self.get_watchlists(user_id)
        if not rows:
            return None
        for w in rows:
            if w.is_default:
                return w
        return rows[0]

    def create_watchlist(
        self, user_id: str, name: str, symbols: list[str], *, is_default: bool = False
    ) -> WatchlistItem:
        uid = user_id
        if len(self._by_user.get(uid, {})) >= _MAX_WATCHLISTS:
            raise ValueError("Maximum of 5 watchlists per user.")
        norm = [_normalize_symbol(s) for s in symbols][: _MAX_SYMBOLS]
        norm = list(dict.fromkeys(norm))
        wid = str(uuid.uuid4())
        now = _utc_now()
        self._by_user.setdefault(uid, {})
        if not self._by_user[uid]:
            is_default = True
        if is_default:
            for w in self._by_user[uid].values():
                w.is_default = False
        item = WatchlistItem(
            user_id=uid,
            watchlist_id=wid,
            name=name.strip() or "Watchlist",
            symbols=norm,
            is_default=is_default,
            created_at=now,
            updated_at=now,
        )
        self._by_user[uid][wid] = item
        return item

    def update_watchlist(
        self,
        user_id: str,
        watchlist_id: str,
        *,
        name: str | None = None,
        symbols: list[str] | None = None,
        is_default: bool | None = None,
    ) -> WatchlistItem | None:
        w = self._by_user.get(user_id, {}).get(watchlist_id)
        if not w:
            return None
        if name is not None:
            w.name = name.strip() or w.name
        if symbols is not None:
            norm = [_normalize_symbol(s) for s in symbols][: _MAX_SYMBOLS]
            w.symbols = list(dict.fromkeys(norm))
        if is_default is True:
            for o in self._by_user[user_id].values():
                o.is_default = False
            w.is_default = True
        w.updated_at = _utc_now()
        return w

    def delete_watchlist(self, user_id: str, watchlist_id: str) -> bool:
        u = self._by_user.get(user_id)
        if not u or watchlist_id not in u:
            return False
        if len(u) <= 1:
            raise ValueError("Cannot delete the last watchlist.")
        del u[watchlist_id]
        if not any(w.is_default for w in u.values()) and u:
            first = sorted(u.values(), key=lambda x: x.created_at)[0]
            first.is_default = True
            first.updated_at = _utc_now()
        return True

    def add_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None:
        w = self._by_user.get(user_id, {}).get(watchlist_id)
        if not w:
            return None
        sym = _normalize_symbol(symbol)
        if sym in w.symbols:
            return w
        if len(w.symbols) >= _MAX_SYMBOLS:
            raise ValueError("Watchlist may contain at most 50 symbols.")
        w.symbols = [*w.symbols, sym]
        w.updated_at = _utc_now()
        return w

    def remove_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None:
        w = self._by_user.get(user_id, {}).get(watchlist_id)
        if not w:
            return None
        sym = str(symbol).strip().upper()
        w.symbols = [s for s in w.symbols if s != sym]
        w.updated_at = _utc_now()
        return w


@dataclass
class DynamoDBWatchlistStore:
    table: Any

    def get_watchlists(self, user_id: str) -> list[WatchlistItem]:
        resp = self.table.query(KeyConditionExpression="userId = :u", ExpressionAttributeValues={":u": user_id})
        items = resp.get("Items") or []
        rows = [WatchlistItem.from_item(user_id, it) for it in items if it.get("watchlistId")]
        return sorted(rows, key=lambda w: (not w.is_default, w.created_at))

    def get_default_watchlist(self, user_id: str) -> WatchlistItem | None:
        rows = self.get_watchlists(user_id)
        if not rows:
            return None
        for w in rows:
            if w.is_default:
                return w
        return rows[0]

    def create_watchlist(
        self, user_id: str, name: str, symbols: list[str], *, is_default: bool = False
    ) -> WatchlistItem:
        existing = self.get_watchlists(user_id)
        if len(existing) >= _MAX_WATCHLISTS:
            raise ValueError("Maximum of 5 watchlists per user.")
        norm = [_normalize_symbol(s) for s in symbols][: _MAX_SYMBOLS]
        norm = list(dict.fromkeys(norm))
        wid = str(uuid.uuid4())
        now = _utc_now()
        if not existing:
            is_default = True
        if is_default:
            for w in existing:
                if w.is_default:
                    self.table.update_item(
                        Key={"userId": user_id, "watchlistId": w.watchlist_id},
                        UpdateExpression="SET isDefault = :f, updatedAt = :t",
                        ExpressionAttributeValues={":f": False, ":t": now},
                    )
        item = {
            "userId": user_id,
            "watchlistId": wid,
            "name": name.strip() or "Watchlist",
            "symbols": norm,
            "isDefault": bool(is_default or not existing),
            "createdAt": now,
            "updatedAt": now,
        }
        self.table.put_item(Item=item)
        return WatchlistItem.from_item(user_id, item)

    def update_watchlist(
        self,
        user_id: str,
        watchlist_id: str,
        *,
        name: str | None = None,
        symbols: list[str] | None = None,
        is_default: bool | None = None,
    ) -> WatchlistItem | None:
        cur = self._get_one(user_id, watchlist_id)
        if not cur:
            return None
        now = _utc_now()
        if is_default is True:
            for w in self.get_watchlists(user_id):
                if w.watchlist_id != watchlist_id and w.is_default:
                    self.table.update_item(
                        Key={"userId": user_id, "watchlistId": w.watchlist_id},
                        UpdateExpression="SET isDefault = :f, updatedAt = :t",
                        ExpressionAttributeValues={":f": False, ":t": now},
                    )
        name_f = name.strip() if name is not None else cur.name
        if not name_f:
            name_f = cur.name
        if symbols is not None:
            sym_f = [_normalize_symbol(s) for s in symbols][: _MAX_SYMBOLS]
            sym_f = list(dict.fromkeys(sym_f))
        else:
            sym_f = list(cur.symbols)
        if is_default is True:
            def_f = True
        elif is_default is False:
            def_f = False
        else:
            def_f = cur.is_default
        item = {
            "userId": user_id,
            "watchlistId": watchlist_id,
            "name": name_f,
            "symbols": sym_f,
            "isDefault": def_f,
            "createdAt": cur.created_at,
            "updatedAt": now,
        }
        self.table.put_item(Item=item)
        return WatchlistItem.from_item(user_id, item)

    def _get_one(self, user_id: str, watchlist_id: str) -> WatchlistItem | None:
        out = self.table.get_item(Key={"userId": user_id, "watchlistId": watchlist_id})
        it = out.get("Item")
        if not it:
            return None
        return WatchlistItem.from_item(user_id, it)

    def delete_watchlist(self, user_id: str, watchlist_id: str) -> bool:
        rows = self.get_watchlists(user_id)
        if len(rows) <= 1:
            raise ValueError("Cannot delete the last watchlist.")
        if not any(w.watchlist_id == watchlist_id for w in rows):
            return False
        self.table.delete_item(Key={"userId": user_id, "watchlistId": watchlist_id})
        remaining = [w for w in rows if w.watchlist_id != watchlist_id]
        if remaining and not any(w.is_default for w in remaining):
            promote = sorted(remaining, key=lambda x: x.created_at)[0]
            self.table.update_item(
                Key={"userId": user_id, "watchlistId": promote.watchlist_id},
                UpdateExpression="SET isDefault = :t, updatedAt = :u",
                ExpressionAttributeValues={":t": True, ":u": _utc_now()},
            )
        return True

    def add_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None:
        w = self._get_one(user_id, watchlist_id)
        if not w:
            return None
        sym = _normalize_symbol(symbol)
        if sym in w.symbols:
            return w
        if len(w.symbols) >= _MAX_SYMBOLS:
            raise ValueError("Watchlist may contain at most 50 symbols.")
        now = _utc_now()
        new_syms = [*w.symbols, sym]
        self.table.update_item(
            Key={"userId": user_id, "watchlistId": watchlist_id},
            UpdateExpression="SET symbols = :s, updatedAt = :u",
            ExpressionAttributeValues={":s": new_syms, ":u": now},
            ReturnValues="ALL_NEW",
        )
        out = self.table.get_item(Key={"userId": user_id, "watchlistId": watchlist_id})
        return WatchlistItem.from_item(user_id, out["Item"])

    def remove_symbol(self, user_id: str, watchlist_id: str, symbol: str) -> WatchlistItem | None:
        w = self._get_one(user_id, watchlist_id)
        if not w:
            return None
        sym = str(symbol).strip().upper()
        new_syms = [s for s in w.symbols if s != sym]
        now = _utc_now()
        self.table.update_item(
            Key={"userId": user_id, "watchlistId": watchlist_id},
            UpdateExpression="SET symbols = :s, updatedAt = :u",
            ExpressionAttributeValues={":s": new_syms, ":u": now},
        )
        out = self.table.get_item(Key={"userId": user_id, "watchlistId": watchlist_id})
        return WatchlistItem.from_item(user_id, out["Item"])


_in_memory_store: InMemoryWatchlistStore | None = None
_dynamo_store: DynamoDBWatchlistStore | None = None


def get_in_memory_watchlist_store() -> InMemoryWatchlistStore:
    global _in_memory_store
    if _in_memory_store is None:
        _in_memory_store = InMemoryWatchlistStore()
    return _in_memory_store


def get_watchlist_store() -> WatchlistStore:
    """Return Dynamo-backed store when ``DYNAMODB_WATCHLISTS_TABLE`` is set; otherwise in-memory."""
    global _dynamo_store
    settings = get_settings()
    name = settings.dynamodb_watchlists_table.strip()
    if not name:
        return get_in_memory_watchlist_store()
    if _dynamo_store is None:
        import boto3

        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        _dynamo_store = DynamoDBWatchlistStore(table=dynamodb.Table(name))
        _LOG.info("watchlist store: DynamoDB table=%s", name)
    return _dynamo_store


def reset_watchlist_stores_for_tests() -> None:
    global _in_memory_store, _dynamo_store
    _in_memory_store = None
    _dynamo_store = None
