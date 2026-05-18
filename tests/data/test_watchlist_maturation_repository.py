"""Tests for stocvest.data.watchlist_maturation_repository."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.data.watchlist_maturation_repository import WatchlistMaturationRepository
from stocvest.models.watchlist import WatchlistEntry, WatchlistState, user_state_gsi_keys


def _entry(**overrides: Any) -> WatchlistEntry:
    base: dict[str, Any] = {
        "user_id": "sub-1",
        "symbol": "AAPL",
        "mode": "swing",
        "state": WatchlistState.NOT_ALIGNED,
        "previous_state": None,
        "state_changed_at": "2026-01-01T00:00:00+00:00",
        "state_change_reason": "",
        "layers_aligned": 0,
    }
    base.update(overrides)
    return WatchlistEntry(**base)


class _FakeDynamoTable:
    """In-memory table matching the repository's get/put/delete/query shapes."""

    def __init__(self) -> None:
        self._by_pk_sk: dict[tuple[str, str], dict[str, Any]] = {}

    def get_item(self, *, Key: dict[str, str]) -> dict[str, Any]:
        item = self._by_pk_sk.get((Key["pk"], Key["sk"]))
        return {"Item": item} if item else {}

    def put_item(self, *, Item: dict[str, Any]) -> None:
        pk, sk = Item["pk"], Item["sk"]
        self._by_pk_sk[(pk, sk)] = dict(Item)

    def delete_item(self, *, Key: dict[str, str]) -> None:
        self._by_pk_sk.pop((Key["pk"], Key["sk"]), None)

    def query(self, **kwargs: Any) -> dict[str, Any]:
        eav = kwargs.get("ExpressionAttributeValues") or {}
        if kwargs.get("IndexName") == "UserStateIndex":
            gpk = eav[":gpk"]
            pre = eav[":pre"]
            items = [
                dict(row)
                for row in self._by_pk_sk.values()
                if row.get("gsi1pk") == gpk and str(row.get("gsi1sk") or "").startswith(pre)
            ]
            return {"Items": items, "LastEvaluatedKey": None}
        if kwargs.get("IndexName") == "ModeTimelineIndex":
            pk = eav[":pk"]
            from_sk = eav.get(":from")
            items = [
                dict(row)
                for row in self._by_pk_sk.values()
                if row.get("gsi1pk") == pk and (from_sk is None or (row.get("gsi1sk") or "") >= from_sk)
            ]
            items.sort(key=lambda r: r.get("gsi1sk") or "")
            if kwargs.get("ScanIndexForward") is False:
                items.reverse()
            return {"Items": items, "LastEvaluatedKey": None}
        pk = eav[":pk"]
        pref = eav[":pref"]
        items = [
            dict(row)
            for row in self._by_pk_sk.values()
            if row.get("pk") == pk and str(row.get("sk") or "").startswith(pref)
        ]
        return {"Items": items, "LastEvaluatedKey": None}


def test_put_entry_sets_user_state_gsi_keys() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    entry = _entry(symbol="nvda", state=WatchlistState.ACTIONABLE, mode="day")
    repo.put_entry(entry)
    stored = table._by_pk_sk[("USER#sub-1", "SYM#NVDA#day")]
    exp_pk, exp_sk = user_state_gsi_keys("sub-1", WatchlistState.ACTIONABLE, "NVDA", "day")
    assert stored["gsi1pk"] == exp_pk
    assert stored["gsi1sk"] == exp_sk


def test_get_entry_roundtrip() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    entry = _entry(symbol="Msft", layers_aligned=4, bias="long")
    repo.put_entry(entry)
    got = repo.get_entry("sub-1", "msft", "swing")
    assert got is not None
    assert got.symbol == "MSFT"
    assert got.layers_aligned == 4
    assert got.bias == "long"


def test_list_for_user_filters_mode_and_exclude_archived() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    repo.put_entry(_entry(symbol="AAA", mode="swing"))
    repo.put_entry(_entry(symbol="BBB", mode="day"))
    repo.put_entry(
        _entry(
            symbol="CCC",
            mode="swing",
            state=WatchlistState.INVALIDATED,
            previous_state=WatchlistState.DEVELOPING,
        )
    )
    repo.put_entry(
        _entry(
            symbol="DDD",
            mode="swing",
            state=WatchlistState.INVALIDATED,
            previous_state=WatchlistState.DEVELOPING,
            archive_after=future,
        )
    )
    swing = repo.list_for_user("sub-1", mode="swing", exclude_archived=True)
    symbols = {e.symbol for e in swing}
    assert symbols == {"AAA", "DDD"}
    all_rows = repo.list_for_user("sub-1", exclude_archived=False)
    assert {e.symbol for e in all_rows} == {"AAA", "BBB", "CCC", "DDD"}


def test_list_by_state_uses_gsi_projection() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    repo.put_entry(_entry(symbol="X", state=WatchlistState.DEVELOPING))
    repo.put_entry(_entry(symbol="Y", state=WatchlistState.ACTIONABLE))
    dev = repo.list_by_state("sub-1", WatchlistState.DEVELOPING)
    assert len(dev) == 1
    assert dev[0].symbol == "X"


def test_delete_symbol_modes() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    repo.put_entry(_entry(symbol="ZZ", mode="swing"))
    repo.put_entry(_entry(symbol="ZZ", mode="day"))
    assert len(table._by_pk_sk) == 2
    repo.delete_symbol("sub-1", "zz", mode="swing")
    assert ("USER#sub-1", "SYM#ZZ#swing") not in table._by_pk_sk
    assert ("USER#sub-1", "SYM#ZZ#day") in table._by_pk_sk
    repo.delete_symbol("sub-1", "ZZ")
    assert table._by_pk_sk == {}


def test_replace_entry_returns_stored_row() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    e1 = _entry(layers_aligned=1)
    repo.put_entry(e1)
    e2 = _entry(layers_aligned=5, state=WatchlistState.ACTIONABLE)
    out = repo.replace_entry(e2)
    assert out is not None
    assert out.layers_aligned == 5
    assert out.state == WatchlistState.ACTIONABLE


def test_item_invalid_mode_defaults_to_swing() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    table.put_item(
        Item={
            "pk": "USER#sub-1",
            "sk": "SYM#BAD#swing",
            "user_id": "sub-1",
            "symbol": "BAD",
            "mode": "bogus",
            "state": WatchlistState.NOT_ALIGNED.value,
            "state_changed_at": "",
            "state_change_reason": "",
            "layers_aligned": 0,
            "gsi1pk": "USER#sub-1",
            "gsi1sk": "STATE#not_aligned#SYM#BAD#MODE#bogus",
        }
    )
    got = repo.get_entry("sub-1", "BAD", "swing")
    assert got is not None
    assert got.mode == "swing"
