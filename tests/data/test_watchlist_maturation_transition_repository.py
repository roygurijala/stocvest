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
