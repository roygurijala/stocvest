"""Tests for watchlist maturation transition repository."""

from __future__ import annotations

from typing import Any

from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


class _FakeDynamoTable:
    def __init__(self) -> None:
        self._by_pk_sk: dict[tuple[str, str], dict[str, Any]] = {}

    def put_item(self, *, Item: dict[str, Any]) -> None:
        self._by_pk_sk[(Item["pk"], Item["sk"])] = dict(Item)

    def query(self, **kwargs: Any) -> dict[str, Any]:
        eav = kwargs.get("ExpressionAttributeValues") or {}
        index = kwargs.get("IndexName")
        if index == "ModeTimelineIndex":
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
        items.sort(key=lambda r: r.get("sk") or "")
        if kwargs.get("ScanIndexForward") is False:
            items.reverse()
        return {"Items": items, "LastEvaluatedKey": None}


def test_put_and_list_chronological() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationTransitionRepository(table)
    for i, aligned in enumerate([2, 3, 4]):
        repo.put_transition(
            WatchlistMaturationTransition(
                user_id="u1",
                symbol="TSLA",
                mode="swing",
                recorded_at=f"2026-05-1{i}T12:00:00+00:00",
                session_date=f"2026-05-1{i}",
                from_state="developing" if i else None,
                to_state="developing",
                layers_aligned=aligned,
                previous_layers_aligned=aligned - 1 if i else None,
                layers_total=6,
                alignment_pct=aligned / 6 * 100,
                bias="long",
                transition_type="unchanged" if i else "initial",
                missing_layers=["internals"],
            )
        )
    rows = repo.list_for_symbol("u1", "TSLA", "swing")
    assert len(rows) == 3
    assert rows[0].layers_aligned == 2
    assert rows[-1].layers_aligned == 4
    stored = next(iter(table._by_pk_sk.values()))
    assert stored.get("ttl") is not None
    assert stored.get("gsi1pk") == "MODE#swing"
    assert "u1" in (stored.get("gsi1sk") or "")


def test_list_for_mode_gsi() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationTransitionRepository(table)
    repo.put_transition(
        WatchlistMaturationTransition(
            user_id="u1",
            symbol="AAPL",
            mode="swing",
            recorded_at="2026-05-10T12:00:00+00:00",
            session_date="2026-05-10",
            from_state=None,
            to_state="developing",
            layers_aligned=3,
            previous_layers_aligned=None,
            layers_total=6,
            alignment_pct=50.0,
            bias="long",
            transition_type="initial",
        )
    )
    repo.put_transition(
        WatchlistMaturationTransition(
            user_id="u2",
            symbol="MSFT",
            mode="day",
            recorded_at="2026-05-11T12:00:00+00:00",
            session_date="2026-05-11",
            from_state=None,
            to_state="developing",
            layers_aligned=2,
            previous_layers_aligned=None,
            layers_total=6,
            alignment_pct=33.0,
            bias="neutral",
            transition_type="initial",
        )
    )
    swing_rows = repo.list_for_mode("swing", limit=10)
    assert len(swing_rows) == 1
    assert swing_rows[0].symbol == "AAPL"
    day_rows = repo.list_for_mode("day", limit=10)
    assert len(day_rows) == 1
    assert day_rows[0].user_id == "u2"
