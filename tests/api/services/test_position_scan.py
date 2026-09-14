"""Tests for the Position universe scan service (POS-D15 stub)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

import stocvest.api.services.position_scan as scan_mod
from stocvest.api.services.position_scan import (
    PositionScanSnapshot,
    _bottom_quartile_threshold,
    compute_and_persist_position_scan,
    get_position_scan_snapshot_sync,
    merge_scan_snapshots,
    rank_candidates,
    reset_position_scan_cache_for_tests,
    run_position_scan_async,
)
from stocvest.api.services.position_scan_store import (
    InMemoryPositionScanStore,
    reset_position_scan_store_for_tests,
)
from stocvest.signals.position_gem_gates import TIER_GEM, TIER_MONITOR

pytestmark = pytest.mark.unit


_PILLAR_LABELS = {
    "F1": "Profitability & quality",
    "F2": "Growth",
    "F3": "Balance sheet & solvency",
    "F4": "Valuation",
    "F5": "Earnings quality & consistency",
}


def _pillar(pid: str, score: int, verdict: str = "bullish", dq: str = "high") -> dict[str, Any]:
    return {
        "pillar_id": pid,
        "label": _PILLAR_LABELS[pid],
        "score": score,
        "verdict": verdict,
        "data_quality": dq,
        "status": "active",
        "chips": [],
    }


def _body(
    symbol: str,
    *,
    fund_score: int,
    rs: float,
    tech_verdict: str = "bullish",
    sector_verdict: str = "neutral",
    market_cap: float | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "symbol": symbol,
        "score": 40,
        "verdict": "bullish",
        "signal_valid_days": 90,
        "regime": "sideways",
        "position_fundamentals": {
            "score": fund_score,
            "verdict": "bullish",
            "data_quality": "high",
            "weakest_pillar_id": "F4",
            "pillars": [
                _pillar("F1", 80),
                _pillar("F2", 74),
                _pillar("F3", 70, "neutral"),
                _pillar("F4", 64, "neutral"),
                _pillar("F5", 72),
            ],
        },
        "layers": [
            {"layer": "fundamentals", "score": fund_score, "verdict": "bullish", "status": "active", "chips": []},
            {
                "layer": "technical",
                "score": 66,
                "verdict": tech_verdict,
                "status": "available",
                "chips": ["Above W-SMA200"],
                "indicator_snapshot": {"mode": "position", "pct_from_52w_high": -4.0, "rs_vs_spy_6m_pct": rs},
            },
            {"layer": "sector", "score": 70 if sector_verdict == "bullish" else 55, "verdict": sector_verdict, "status": "available", "chips": []},
            {"layer": "macro", "score": 52, "verdict": "neutral", "status": "available", "chips": []},
        ],
    }
    if market_cap is not None:
        body["market_cap"] = market_cap
    return body


def test_bottom_quartile_threshold_needs_four_points() -> None:
    assert _bottom_quartile_threshold([1.0, 2.0, 3.0]) is None
    assert _bottom_quartile_threshold([0.0, 10.0, 20.0, 30.0]) == pytest.approx(7.5)


def test_rank_candidates_sorts_gem_first_then_rank() -> None:
    bodies = [
        _body("LOWQ", fund_score=55, rs=5.0),  # G1 fails, no tailwind -> monitor
        _body("HIGH", fund_score=90, rs=5.0, sector_verdict="bullish", market_cap=8e9),
        _body("MIDD", fund_score=74, rs=5.0, sector_verdict="bullish", market_cap=6e9),
    ]
    rows = rank_candidates(bodies)
    assert [r.symbol for r in rows] == ["HIGH", "MIDD", "LOWQ"]
    assert rows[0].tier == TIER_GEM
    assert rows[-1].tier == TIER_MONITOR
    assert rows[0].rank >= rows[1].rank


def test_rank_candidates_applies_rs_quartile_gate() -> None:
    # G6 still records a miss; it no longer blocks a growth-led gem.
    bodies = [
        _body("AAA", fund_score=85, rs=20.0, sector_verdict="bullish", market_cap=8e9),
        _body("BBB", fund_score=85, rs=15.0, sector_verdict="bullish", market_cap=7e9),
        _body("CCC", fund_score=85, rs=12.0, sector_verdict="bullish", market_cap=6e9),
        _body("DDD", fund_score=85, rs=-30.0, sector_verdict="bullish", market_cap=5e9),
    ]
    rows = rank_candidates(bodies)
    by_symbol = {r.symbol: r for r in rows}
    assert "G6" in by_symbol["DDD"].failing_gates
    assert by_symbol["DDD"].tier == TIER_GEM


def test_run_scan_uses_injected_compose_and_skips_failures() -> None:
    reset_position_scan_cache_for_tests()

    async def compose(sym: str) -> dict[str, Any]:
        if sym == "BAD":
            raise RuntimeError("boom")
        return _body(sym, fund_score=85, rs=10.0)

    snap = asyncio.run(
        run_position_scan_async(universe=["AAA", "BAD", "BBB"], compose=compose)
    )
    assert isinstance(snap, PositionScanSnapshot)
    assert snap.universe_size == 3
    assert {c.symbol for c in snap.candidates} == {"AAA", "BBB"}


def test_merge_scan_snapshots_unions_and_resorts() -> None:
    first = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 8, tzinfo=__import__("datetime").timezone.utc),
        universe_size=1,
        candidates=rank_candidates([_body("AAPL", fund_score=90, rs=5.0)]),
    )
    second = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 9, tzinfo=__import__("datetime").timezone.utc),
        universe_size=1,
        candidates=rank_candidates(
            [_body("RKLB", fund_score=85, rs=15.0, sector_verdict="bullish", market_cap=8e9)]
        ),
    )
    merged = merge_scan_snapshots(first, second, universe_size=26)
    assert merged.universe_size == 26
    assert [c.symbol for c in merged.candidates] == ["RKLB", "AAPL"]


def test_live_scan_persists_curated_before_discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_position_scan_cache_for_tests()
    store = InMemoryPositionScanStore()
    reset_position_scan_store_for_tests(store)
    curated = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 8, tzinfo=__import__("datetime").timezone.utc),
        universe_size=25,
        candidates=rank_candidates([_body("AAPL", fund_score=90, rs=5.0)]),
    )
    extra = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 9, tzinfo=__import__("datetime").timezone.utc),
        universe_size=1,
        candidates=rank_candidates(
            [_body("RKLB", fund_score=85, rs=15.0, sector_verdict="bullish", market_cap=8e9)]
        ),
    )

    async def fake_run(*, universe=None, compose=None, concurrency=6):
        symbols = list(universe or [])
        if symbols == list(scan_mod.POSITION_SCAN_UNIVERSE_V1):
            assert store.get() is None
            return curated
        return extra

    async def fake_universe() -> list[str]:
        assert store.get() is curated
        return ["RKLB", *scan_mod.POSITION_SCAN_UNIVERSE_V1]

    monkeypatch.setattr(scan_mod, "run_position_scan_async", fake_run)
    monkeypatch.setattr(
        "stocvest.api.services.position_universe.build_live_scan_universe",
        fake_universe,
    )
    result = asyncio.run(scan_mod._run_live_position_scan())
    assert [c.symbol for c in result.candidates] == ["RKLB", "AAPL"]
    assert store.get() is curated

    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(None)


def test_snapshot_filter_and_api_dict() -> None:
    bodies = [
        _body("HIGH", fund_score=90, rs=5.0, sector_verdict="bullish", market_cap=8e9),
        _body("LOWQ", fund_score=55, rs=5.0),
    ]
    snap = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 8, tzinfo=__import__("datetime").timezone.utc),
        universe_size=2,
        candidates=rank_candidates(bodies),
    )
    gem = snap.to_api_dict(tier="gem", limit=50, cached=True)
    assert gem["mode"] == "position"
    assert gem["cached"] is True
    assert all(c["tier"] == "gem" for c in gem["candidates"])
    assert gem["count"] == 1

    all_rows = snap.to_api_dict(tier="all", limit=50)
    assert all_rows["count"] == 2


def test_api_dict_action_gated_by_personal_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """PERSONAL-MODE: candidates carry a Buy/Watch action only when the flag is on."""
    from stocvest.utils.config import get_settings

    bodies = [_body("HIGH", fund_score=90, rs=5.0), _body("LOWQ", fund_score=55, rs=5.0)]
    snap = PositionScanSnapshot(
        generated_at=__import__("datetime").datetime(2026, 9, 8, tzinfo=__import__("datetime").timezone.utc),
        universe_size=2,
        candidates=rank_candidates(bodies),
    )
    try:
        # Personal mode ON → gem/strong -> Buy, monitor -> Watch.
        monkeypatch.setenv("STOCVEST_PERSONAL_ADVICE_MODE_ENABLED", "true")
        get_settings.cache_clear()
        by = {c["symbol"]: c for c in snap.to_api_dict(tier="all", limit=50)["candidates"]}
        assert by["HIGH"]["action"] == "buy" and by["HIGH"]["action_label"] == "Buy"
        assert by["LOWQ"]["action"] == "watch" and by["LOWQ"]["action_label"] == "Watch"

        # Product mode OFF → no action keys at all (byte-identical to the POS-D12 contract).
        monkeypatch.setenv("STOCVEST_PERSONAL_ADVICE_MODE_ENABLED", "false")
        get_settings.cache_clear()
        rows2 = snap.to_api_dict(tier="all", limit=50)["candidates"]
        assert all("action" not in c and "action_label" not in c for c in rows2)
    finally:
        get_settings.cache_clear()


def test_snapshot_sync_caches_and_forces(monkeypatch: pytest.MonkeyPatch) -> None:
    import datetime as _dt

    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(InMemoryPositionScanStore())
    calls = {"n": 0}

    async def fake_live_scan() -> PositionScanSnapshot:
        calls["n"] += 1
        return PositionScanSnapshot(
            generated_at=_dt.datetime(2026, 9, 8, tzinfo=_dt.timezone.utc),
            universe_size=1,
            candidates=[],
        )

    monkeypatch.setattr(scan_mod, "_run_live_position_scan", fake_live_scan)

    snap1, cached1 = get_position_scan_snapshot_sync()
    assert snap1 is None and cached1 is False and calls["n"] == 0
    # Workers / tests still compose via force or compute_and_persist.
    snap2, cached2 = get_position_scan_snapshot_sync(force=True)
    assert cached2 is False and calls["n"] == 1 and snap2 is not None
    # Second unforced call hits the cache — no recompute.
    snap3, cached3 = get_position_scan_snapshot_sync()
    assert cached3 is True and calls["n"] == 1 and snap3 is snap2
    persisted = compute_and_persist_position_scan()
    assert calls["n"] == 2 and persisted is not None

    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(None)


def test_snapshot_sync_hydrates_from_store_without_rescan(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cold in-process cache must serve the persisted weekly snapshot, not compose 25 names."""
    import datetime as _dt

    reset_position_scan_cache_for_tests()
    store = InMemoryPositionScanStore()
    stored = PositionScanSnapshot(
        generated_at=_dt.datetime(2026, 9, 8, tzinfo=_dt.timezone.utc),
        universe_size=25,
        candidates=rank_candidates([_body("HIGH", fund_score=90, rs=5.0)]),
    )
    store.put(stored)
    reset_position_scan_store_for_tests(store)
    calls = {"n": 0}

    def fake_scan(**_kwargs) -> PositionScanSnapshot:
        calls["n"] += 1
        raise AssertionError("request path must not live-scan when a store snapshot exists")

    monkeypatch.setattr(scan_mod, "run_position_scan", fake_scan)
    snap, cached = get_position_scan_snapshot_sync()
    assert cached is True and calls["n"] == 0
    assert snap.universe_size == 25
    assert [c.symbol for c in snap.candidates] == ["HIGH"]

    reset_position_scan_cache_for_tests()
    reset_position_scan_store_for_tests(None)
