"""Unit tests for the POS-D15 weekly Position gem-scan batch worker."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services.position_scan import (
    GemCandidate,
    PositionScanSnapshot,
    get_cached_position_scan_snapshot,
    reset_position_scan_cache_for_tests,
)
from stocvest.api.services.position_scan_store import (
    InMemoryPositionScanStore,
    reset_position_scan_store_for_tests,
)
from stocvest.workers import position_scan_batch as batch

pytestmark = pytest.mark.unit


def _candidate(symbol: str, tier: str) -> GemCandidate:
    return GemCandidate(
        symbol=symbol, tier=tier, rank=90.0, composite_score=70, verdict="bullish",
        fundamentals_score=80, fundamentals_verdict="bullish", technical_score=55,
        technical_verdict="neutral", sector_verdict="bullish", data_quality="high",
        weakest_pillar_id="F4", weakest_pillar_label="Valuation", rs_vs_spy_6m_pct=8.0,
        signal_valid_days=90, why="why", pillars=[], failing_gates=[],
    )


@pytest.fixture(autouse=True)
def _isolate() -> None:
    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(InMemoryPositionScanStore())
    yield
    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(None)


@pytest.mark.asyncio
async def test_batch_scans_persists_and_warms_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 6, tzinfo=timezone.utc),
        universe_size=3,
        candidates=[_candidate("AAA", "gem"), _candidate("BBB", "strong"), _candidate("CCC", "gem")],
    )

    async def _fake_universe(**_kw):
        return ["AAA", "BBB", "CCC"]

    async def _fake_scan(*, universe, concurrency):
        assert list(universe) == ["AAA", "BBB", "CCC"]
        return snapshot

    monkeypatch.setattr(batch, "build_scan_universe", _fake_universe)
    monkeypatch.setattr(batch, "run_position_scan_async", _fake_scan)

    out = await batch.run_position_scan_batch_async()

    assert out["job"] == "position_scan_batch"
    assert out["universe"] == 3
    assert out["candidates"] == 3
    assert out["tiers"] == {"gem": 2, "strong": 1}
    assert out["persisted"] is True
    # Persisted to the cross-instance store AND warmed the in-process cache.
    assert get_cached_position_scan_snapshot() is snapshot


@pytest.mark.asyncio
async def test_batch_succeeds_even_if_persist_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 6, tzinfo=timezone.utc),
        universe_size=1,
        candidates=[_candidate("AAA", "gem")],
    )

    class _BoomStore:
        def put(self, _s):
            raise RuntimeError("dynamo down")

        def get(self):
            return None

    reset_position_scan_store_for_tests(_BoomStore())

    async def _fake_universe(**_kw):
        return ["AAA"]

    async def _fake_scan(*, universe, concurrency):
        return snapshot

    monkeypatch.setattr(batch, "build_scan_universe", _fake_universe)
    monkeypatch.setattr(batch, "run_position_scan_async", _fake_scan)

    out = await batch.run_position_scan_batch_async()
    assert out["persisted"] is False
    # The invoking instance is still warmed even when cross-instance persistence fails.
    assert get_cached_position_scan_snapshot() is snapshot


def test_cold_cache_hydrates_from_store(monkeypatch: pytest.MonkeyPatch) -> None:
    # With an empty in-process cache, the read path pulls the persisted snapshot.
    snapshot = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 6, tzinfo=timezone.utc),
        universe_size=1,
        candidates=[_candidate("AAA", "gem")],
    )
    store = InMemoryPositionScanStore()
    store.put(snapshot)
    reset_position_scan_store_for_tests(store)
    reset_position_scan_cache_for_tests()

    got = get_cached_position_scan_snapshot()
    assert got is snapshot
