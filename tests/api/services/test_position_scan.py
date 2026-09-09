"""Tests for the Position universe scan service (POS-D15 stub)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from stocvest.api.services.position_scan import (
    PositionScanSnapshot,
    _bottom_quartile_threshold,
    rank_candidates,
    reset_position_scan_cache_for_tests,
    run_position_scan_async,
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


def _body(symbol: str, *, fund_score: int, rs: float, tech_verdict: str = "bullish") -> dict[str, Any]:
    return {
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
            {"layer": "sector", "score": 55, "verdict": "neutral", "status": "available", "chips": []},
            {"layer": "macro", "score": 52, "verdict": "neutral", "status": "available", "chips": []},
        ],
    }


def test_bottom_quartile_threshold_needs_four_points() -> None:
    assert _bottom_quartile_threshold([1.0, 2.0, 3.0]) is None
    assert _bottom_quartile_threshold([0.0, 10.0, 20.0, 30.0]) == pytest.approx(7.5)


def test_rank_candidates_sorts_gem_first_then_rank() -> None:
    bodies = [
        _body("LOWQ", fund_score=55, rs=5.0),  # G1 fails -> monitor
        _body("HIGH", fund_score=90, rs=5.0),  # gem, higher rank
        _body("MIDD", fund_score=74, rs=5.0),  # gem, lower rank
    ]
    rows = rank_candidates(bodies)
    assert [r.symbol for r in rows] == ["HIGH", "MIDD", "LOWQ"]
    assert rows[0].tier == TIER_GEM
    assert rows[-1].tier == TIER_MONITOR
    assert rows[0].rank >= rows[1].rank


def test_rank_candidates_applies_rs_quartile_gate() -> None:
    # Four strong names; one has clearly bottom-quartile RS -> G6 fails -> not gem.
    bodies = [
        _body("AAA", fund_score=85, rs=20.0),
        _body("BBB", fund_score=85, rs=15.0),
        _body("CCC", fund_score=85, rs=12.0),
        _body("DDD", fund_score=85, rs=-30.0),
    ]
    rows = rank_candidates(bodies)
    by_symbol = {r.symbol: r for r in rows}
    assert by_symbol["DDD"].tier != TIER_GEM
    assert "G6" in by_symbol["DDD"].failing_gates


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


def test_snapshot_filter_and_api_dict() -> None:
    bodies = [_body("HIGH", fund_score=90, rs=5.0), _body("LOWQ", fund_score=55, rs=5.0)]
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
