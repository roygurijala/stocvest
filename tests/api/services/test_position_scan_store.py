"""Unit tests for the POS-D15 snapshot serialization + cross-instance store."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services import position_scan_store as store_mod
from stocvest.api.services.position_scan import GemCandidate, PositionScanSnapshot
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
