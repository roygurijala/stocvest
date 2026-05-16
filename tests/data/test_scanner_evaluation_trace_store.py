"""Scanner evaluation trace DynamoDB store."""

from __future__ import annotations

from typing import Any

import pytest

from stocvest.data import scanner_evaluation_trace_store as store


class _FakeTable:
    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}

    def put_item(self, *, TableName: str, Item: dict[str, Any]) -> None:
        _ = TableName
        uid = Item["userId"]["S"]
        sk = Item["sk"]["S"]
        self.items[(uid, sk)] = Item

    def get_item(self, *, TableName: str, Key: dict[str, Any], ConsistentRead: bool = False) -> dict:
        _ = TableName, ConsistentRead
        uid = Key["userId"]["S"]
        sk = Key["sk"]["S"]
        item = self.items.get((uid, sk))
        return {"Item": item} if item else {}


@pytest.fixture(autouse=True)
def _fake_dynamo(monkeypatch: pytest.MonkeyPatch) -> _FakeTable:
    table = _FakeTable()
    monkeypatch.setattr(store, "_table_name", lambda: "ScannerEvaluationTrace")
    monkeypatch.setattr(store.boto3, "client", lambda _svc: table)
    return table


def test_put_and_get_round_trip() -> None:
    rows = [
        {
            "symbol": "NVDA",
            "desk": "day",
            "gate": "session_rvol",
            "detail": "Session volume 12% below expected intraday pace",
            "outcome": "did_not_qualify",
        }
    ]
    store.put_scanner_evaluation_trace("user-1", "day", rows, session_date="2026-05-16")
    doc = store.get_scanner_evaluation_trace("user-1", "day", session_date="2026-05-16")
    assert doc is not None
    assert doc["evaluation_trace"][0]["symbol"] == "NVDA"


def test_get_merged_both_desks() -> None:
    store.put_scanner_evaluation_trace(
        "user-1",
        "day",
        [{"symbol": "A", "desk": "day", "gate": "x", "detail": "d", "outcome": "did_not_qualify"}],
        session_date="2026-05-16",
    )
    store.put_scanner_evaluation_trace(
        "user-1",
        "swing",
        [{"symbol": "B", "desk": "swing", "gate": "y", "detail": "d", "outcome": "did_not_qualify"}],
        session_date="2026-05-16",
    )
    merged = store.get_scanner_evaluation_traces_merged(
        "user-1", mode="both", session_date="2026-05-16", limit=20
    )
    symbols = {r["symbol"] for r in merged}
    assert symbols == {"A", "B"}
