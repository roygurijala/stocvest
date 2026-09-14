"""Unit tests for the POS-D15 snapshot serialization + cross-instance store."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from stocvest.api.services import position_scan_store as store_mod
from stocvest.api.services.position_scan import (
    POSITION_SCAN_ENGINE_VERSION,
    GemCandidate,
    GemListChange,
    PositionScanSnapshot,
    PositionScanUniverse,
)
from stocvest.api.services.position_scan_store import (
    DynamoPositionScanStore,
    InMemoryPositionScanStore,
    get_position_scan_store,
    reset_position_scan_store_for_tests,
)

pytestmark = pytest.mark.unit


def _candidate(symbol: str, tier: str) -> GemCandidate:
    return GemCandidate(
        symbol=symbol,
        tier=tier,
        rank=91.5,
        composite_score=72,
        verdict="bullish",
        fundamentals_score=80,
        fundamentals_verdict="bullish",
        technical_score=60,
        technical_verdict="neutral",
        sector_verdict="bullish",
        data_quality="high",
        weakest_pillar_id="F4",
        weakest_pillar_label="Valuation",
        rs_vs_spy_6m_pct=12.3,
        signal_valid_days=90,
        why="Durable quality compounder.",
        pillars=[{"pillar_id": "F1", "label": "Profitability", "score": 82, "verdict": "bullish"}],
        failing_gates=[],
    )


def _snapshot() -> PositionScanSnapshot:
    return PositionScanSnapshot(
        generated_at=datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc),
        universe_size=500,
        candidates=[_candidate("AAA", "gem"), _candidate("BBB", "strong")],
    )


def test_snapshot_store_dict_round_trip() -> None:
    snap = _snapshot()
    rehydrated = PositionScanSnapshot.from_store_dict(snap.to_store_dict())
    assert rehydrated.universe_size == 500
    assert [c.symbol for c in rehydrated.candidates] == ["AAA", "BBB"]
    c0 = rehydrated.candidates[0]
    assert c0.tier == "gem" and c0.rank == 91.5 and c0.weakest_pillar_id == "F4"
    assert c0.pillars[0]["pillar_id"] == "F1"
    assert rehydrated.generated_at == snap.generated_at
    assert rehydrated.engine_version == POSITION_SCAN_ENGINE_VERSION
    assert rehydrated.list_delta == []
    assert rehydrated.universe_generated_at is None


def test_snapshot_store_dict_round_trips_list_delta() -> None:
    snap = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc),
        universe_size=2,
        candidates=[_candidate("AAA", "gem")],
        list_delta=[GemListChange(symbol="AAA", change="entered", reason="added to hunt pond")],
        universe_generated_at=datetime(2026, 9, 10, tzinfo=timezone.utc),
    )
    rehydrated = PositionScanSnapshot.from_store_dict(snap.to_store_dict())
    assert [(c.symbol, c.change, c.reason) for c in rehydrated.list_delta] == [
        ("AAA", "entered", "added to hunt pond")
    ]
    assert rehydrated.universe_generated_at == snap.universe_generated_at
    assert rehydrated.candidates[0].growth_led is False


def test_from_store_dict_missing_engine_version_is_blank() -> None:
    blob = _snapshot().to_store_dict()
    del blob["engine_version"]
    rehydrated = PositionScanSnapshot.from_store_dict(blob)
    assert rehydrated.engine_version == ""
    assert [c.symbol for c in rehydrated.candidates] == ["AAA", "BBB"]


def test_from_store_dict_skips_malformed_candidate_rows() -> None:
    blob = _snapshot().to_store_dict()
    blob["candidates"].append("not-a-dict")  # type: ignore[arg-type]
    rehydrated = PositionScanSnapshot.from_store_dict(blob)
    assert [c.symbol for c in rehydrated.candidates] == ["AAA", "BBB"]  # bad row skipped


def test_in_memory_store_put_get() -> None:
    store = InMemoryPositionScanStore()
    assert store.get() is None
    snap = _snapshot()
    assert store.put(snap) is True
    assert store.get() is snap
    assert store.invalidate() is True
    assert store.get() is None


def test_in_memory_universe_put_get() -> None:
    store = InMemoryPositionScanStore()
    assert store.get_universe() is None
    pond = PositionScanUniverse(
        symbols=["RKLB", "AAPL"],
        generated_at=datetime(2026, 9, 10, tzinfo=timezone.utc),
        source="live",
    )
    assert store.put_universe(pond) is True
    assert store.get_universe() is pond
    store.invalidate()
    assert store.get() is None
    assert store.get_universe() is pond


def test_universe_from_store_dict_missing_generated_at_is_none() -> None:
    assert PositionScanUniverse.from_store_dict({"symbols": ["AAPL"]}) is None
    assert PositionScanUniverse.from_store_dict({"symbols": ["AAPL"], "generated_at": "not-a-date"}) is None


def test_universe_is_stale_after_seven_days() -> None:
    gen = datetime(2026, 9, 1, tzinfo=timezone.utc)
    pond = PositionScanUniverse(symbols=["AAPL"], generated_at=gen, source="live")
    assert pond.is_stale(now=datetime(2026, 9, 7, tzinfo=timezone.utc)) is False
    assert pond.is_stale(now=datetime(2026, 9, 8, tzinfo=timezone.utc)) is True


def test_snapshot_key_is_stable_not_versioned() -> None:
    assert store_mod._SNAPSHOT_KEY == "position_scan_snapshot"  # noqa: SLF001
    assert store_mod._UNIVERSE_KEY == "position_scan_universe"  # noqa: SLF001
    assert store_mod._LOCK_KEY == "position_scan_refresh_lock"  # noqa: SLF001
    assert store_mod._MIGRATION_KEYS == (  # noqa: SLF001
        "position_scan_snapshot_v2",
        "position_scan_snapshot_v1",
    )


def test_dynamo_get_migrates_legacy_v2_onto_stable_key() -> None:
    blob = json.dumps(_snapshot().to_store_dict())
    items: dict[str, dict] = {
        "position_scan_snapshot_v2": {"snapshot_key": "position_scan_snapshot_v2", "blob": blob},
    }

    class _FakeTable:
        def get_item(self, Key: dict) -> dict:
            item = items.get(str(Key.get("snapshot_key") or ""))
            return {"Item": item} if item else {}

        def put_item(self, Item: dict) -> None:
            items[str(Item["snapshot_key"])] = Item

    store = DynamoPositionScanStore("PositionScanSnapshot")
    store._table = _FakeTable()  # noqa: SLF001
    got = store.get()
    assert got is not None
    assert [c.symbol for c in got.candidates] == ["AAA", "BBB"]
    assert "position_scan_snapshot" in items
    promoted = store.get()
    assert promoted is not None
    assert [c.symbol for c in promoted.candidates] == ["AAA", "BBB"]


def test_in_memory_claim_refresh_is_single_flight() -> None:
    store = InMemoryPositionScanStore()
    assert store.try_claim_refresh(stale_after_seconds=180) is True
    assert store.try_claim_refresh(stale_after_seconds=180) is False
    store._claimed_at = 0.0  # noqa: SLF001 — expire the lock for the next claim
    assert store.try_claim_refresh(stale_after_seconds=180) is True


def test_factory_returns_in_memory_without_table(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_position_scan_store_for_tests(None)
    monkeypatch.setattr(
        store_mod, "get_settings", lambda: type("S", (), {"stocvest_position_scan_table": ""})()
    )
    assert isinstance(get_position_scan_store(), InMemoryPositionScanStore)


def test_factory_returns_dynamo_when_table_set(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_position_scan_store_for_tests(None)
    monkeypatch.setattr(
        store_mod,
        "get_settings",
        lambda: type("S", (), {"stocvest_position_scan_table": "stocvest-position-scan"})(),
    )
    assert isinstance(get_position_scan_store(), DynamoPositionScanStore)
    reset_position_scan_store_for_tests(None)  # don't leak the Dynamo store to other tests
