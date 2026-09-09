"""Unit tests for Position gem gates G1-G9, gem_rank, and tier resolution (POS-D15)."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from stocvest.signals.position_gem_gates import (
    GEM_GATE_IDS,
    TIER_GEM,
    TIER_INSUFFICIENT,
    TIER_MONITOR,
    TIER_STRONG,
    build_gem_why,
    compute_gem_rank,
    evaluate_gem_gates,
    extract_candidate_features,
    failing_gates,
    min_pillar_score,
    resolve_gem_tier,
)

pytestmark = pytest.mark.unit


_PILLAR_LABELS = {
    "F1": "Profitability & quality",
    "F2": "Growth",
    "F3": "Balance sheet & solvency",
    "F4": "Valuation",
    "F5": "Earnings quality & consistency",
}


def _pillar(pid: str, score: int, verdict: str = "bullish", *, dq: str = "high", chips: list[str] | None = None) -> dict[str, Any]:
    return {
        "pillar_id": pid,
        "label": _PILLAR_LABELS[pid],
        "score": score,
        "verdict": verdict,
        "data_quality": dq,
        "status": "active",
        "chips": chips or [],
    }


def _gem_body() -> dict[str, Any]:
    """A body that passes all nine gem gates by default."""
    return {
        "symbol": "AAPL",
        "score": 40,
        "verdict": "bullish",
        "signal_valid_days": 90,
        "regime": "sideways",
        "position_fundamentals": {
            "score": 78,
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
            {
                "layer": "fundamentals",
                "score": 78,
                "verdict": "bullish",
                "status": "active",
                "chips": [],
            },
            {
                "layer": "technical",
                "score": 66,
                "verdict": "bullish",
                "status": "available",
                "chips": ["Above W-SMA200", "RS vs SPY 6M +8.0%"],
                "indicator_snapshot": {
                    "mode": "position",
                    "pct_from_52w_high": -4.0,
                    "rs_vs_spy_6m_pct": 8.0,
                },
            },
            {"layer": "sector", "score": 55, "verdict": "neutral", "status": "available", "chips": []},
            {"layer": "macro", "score": 52, "verdict": "neutral", "status": "available", "chips": []},
        ],
    }


def _features(body: dict[str, Any]):
    return extract_candidate_features(body)


# --------------------------------------------------------------------------- extraction


def test_extract_features_reads_pillars_and_layers() -> None:
    f = _features(_gem_body())
    assert f.symbol == "AAPL"
    assert f.fundamentals_score == 78
    assert set(f.pillars) == {"F1", "F2", "F3", "F4", "F5"}
    assert f.technical_score == 66
    assert f.above_sma200 is True
    assert f.rs_vs_spy_6m_pct == 8.0
    assert f.sector_verdict == "neutral"
    assert f.signal_valid_days == 90


def test_extract_features_below_sma200_chip() -> None:
    body = _gem_body()
    body["layers"][1]["chips"] = ["Below W-SMA200"]
    assert _features(body).above_sma200 is False


def test_min_pillar_score() -> None:
    assert min_pillar_score(_features(_gem_body())) == 64


# --------------------------------------------------------------------------- all-pass


def test_all_gates_pass_for_gem_body() -> None:
    f = _features(_gem_body())
    gates = evaluate_gem_gates(f, rs_bottom_quartile_threshold=-5.0)
    assert all(gates[g] for g in GEM_GATE_IDS), gates
    assert resolve_gem_tier(f, gates) == TIER_GEM


# --------------------------------------------------------------------------- G1


def test_g1_fails_when_layer_below_72() -> None:
    body = _gem_body()
    body["position_fundamentals"]["score"] = 71
    gates = evaluate_gem_gates(_features(body))
    assert gates["G1"] is False


def test_g1_fails_when_any_pillar_below_floor() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][3]["score"] = 59  # F4
    gates = evaluate_gem_gates(_features(body))
    assert gates["G1"] is False


def test_g1_fails_when_pillar_missing() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"] = body["position_fundamentals"]["pillars"][:4]
    gates = evaluate_gem_gates(_features(body))
    assert gates["G1"] is False


# --------------------------------------------------------------------------- G2


def test_g2_fails_when_f5_bearish() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][4]["verdict"] = "bearish"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G2"] is False


def test_g2_fails_on_accruals_flag() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][4]["chips"] = ["High accruals vs operating cash flow"]
    gates = evaluate_gem_gates(_features(body))
    assert gates["G2"] is False


# --------------------------------------------------------------------------- G3


def test_g3_fails_when_f3_bearish() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][2]["verdict"] = "bearish"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G3"] is False


def test_g3_fails_on_solvency_red_flag() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][2]["chips"] = ["Interest coverage below 1.5x"]
    gates = evaluate_gem_gates(_features(body))
    assert gates["G3"] is False


def test_g3_fails_on_elevated_leverage_flag() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][2]["chips"] = ["Elevated leverage (D/E 3.1)"]
    gates = evaluate_gem_gates(_features(body))
    assert gates["G3"] is False


# --------------------------------------------------------------------------- G4 (value trap)


def test_g4_fails_when_f4_bearish_without_quality() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][3]["verdict"] = "bearish"  # F4
    body["position_fundamentals"]["pillars"][0]["verdict"] = "neutral"  # F1
    gates = evaluate_gem_gates(_features(body))
    assert gates["G4"] is False


def test_g4_passes_when_f4_bearish_but_quality_compounder() -> None:
    body = _gem_body()
    body["position_fundamentals"]["pillars"][3]["verdict"] = "bearish"  # F4
    body["position_fundamentals"]["pillars"][0]["verdict"] = "bullish"  # F1
    body["position_fundamentals"]["pillars"][1]["verdict"] = "bullish"  # F2
    gates = evaluate_gem_gates(_features(body))
    assert gates["G4"] is True


# --------------------------------------------------------------------------- G5


def test_g5_fails_on_sharp_breakdown() -> None:
    body = _gem_body()
    body["layers"][1]["indicator_snapshot"]["pct_from_52w_high"] = -30.0
    gates = evaluate_gem_gates(_features(body))
    assert gates["G5"] is False


def test_g5_fails_when_below_sma200_and_not_in_base() -> None:
    body = _gem_body()
    body["layers"][1]["chips"] = ["Below W-SMA200"]
    gates = evaluate_gem_gates(_features(body))
    assert gates["G5"] is False


def test_g5_passes_in_base_even_without_sma200() -> None:
    body = _gem_body()
    body["layers"][1]["chips"] = []
    body["layers"][1]["indicator_snapshot"]["in_base"] = True
    gates = evaluate_gem_gates(_features(body))
    assert gates["G5"] is True


# --------------------------------------------------------------------------- G6


def test_g6_fails_when_rs_bottom_quartile() -> None:
    body = _gem_body()
    body["layers"][1]["indicator_snapshot"]["rs_vs_spy_6m_pct"] = -12.0
    gates = evaluate_gem_gates(_features(body), rs_bottom_quartile_threshold=-5.0)
    assert gates["G6"] is False


def test_g6_degrades_to_pass_without_threshold() -> None:
    body = _gem_body()
    body["layers"][1]["indicator_snapshot"]["rs_vs_spy_6m_pct"] = -12.0
    gates = evaluate_gem_gates(_features(body), rs_bottom_quartile_threshold=None)
    assert gates["G6"] is True


# --------------------------------------------------------------------------- G7


def test_g7_fails_in_avoid_regime() -> None:
    body = _gem_body()
    body["regime"] = "bear"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G7"] is False


def test_g7_fails_when_sector_bearish() -> None:
    body = _gem_body()
    body["layers"][2]["verdict"] = "bearish"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G7"] is False


# --------------------------------------------------------------------------- G9


def test_g9_fails_on_low_data_quality() -> None:
    body = _gem_body()
    body["position_fundamentals"]["data_quality"] = "low"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G9"] is False


def test_g9_fails_when_fewer_than_four_quality_pillars() -> None:
    body = _gem_body()
    for p in body["position_fundamentals"]["pillars"][:3]:
        p["data_quality"] = "low"
    gates = evaluate_gem_gates(_features(body))
    assert gates["G9"] is False


# --------------------------------------------------------------------------- tiers


def test_tier_strong_when_environment_misses() -> None:
    body = _gem_body()
    body["layers"][1]["chips"] = ["Below W-SMA200"]  # G5 fails
    f = _features(body)
    gates = evaluate_gem_gates(f)
    assert gates["G5"] is False
    assert resolve_gem_tier(f, gates) == TIER_STRONG


def test_tier_monitor_when_core_fails() -> None:
    body = _gem_body()
    body["position_fundamentals"]["score"] = 55  # G1 fails (core)
    f = _features(body)
    gates = evaluate_gem_gates(f)
    assert resolve_gem_tier(f, gates) == TIER_MONITOR


def test_tier_insufficient_when_no_fundamentals() -> None:
    body = _gem_body()
    body["position_fundamentals"] = {"score": None, "verdict": "neutral", "pillars": []}
    f = _features(body)
    gates = evaluate_gem_gates(f)
    assert resolve_gem_tier(f, gates) == TIER_INSUFFICIENT


def test_tier_insufficient_on_insufficient_status() -> None:
    body = {"symbol": "ZZZ", "status": "insufficient_data", "position_fundamentals": {"score": 80, "pillars": []}}
    f = _features(body)
    gates = evaluate_gem_gates(f)
    assert resolve_gem_tier(f, gates) == TIER_INSUFFICIENT


# --------------------------------------------------------------------------- rank


def test_gem_rank_weighting_formula() -> None:
    f = _features(_gem_body())
    # 0.45*78 + 0.20*66 + 0.15*55 + 0.10*52 + 0.10*64 = 68.15
    assert compute_gem_rank(f) == pytest.approx(68.15, abs=0.01)


def test_gem_rank_clamped_and_bounded() -> None:
    body = _gem_body()
    body["position_fundamentals"]["score"] = 100
    body["layers"][1]["score"] = 100
    body["layers"][2]["score"] = 100
    body["layers"][3]["score"] = 100
    for p in body["position_fundamentals"]["pillars"]:
        p["score"] = 100
    assert compute_gem_rank(_features(body)) == 100.0


def test_gem_rank_missing_support_layers_neutral() -> None:
    body = _gem_body()
    body["layers"] = [body["layers"][0]]  # only fundamentals row
    f = _features(body)
    # 0.45*78 + (0.20+0.15+0.10)*50 + 0.10*64 = 64.0
    assert compute_gem_rank(f) == pytest.approx(64.0, abs=0.01)


# --------------------------------------------------------------------------- why / helpers


def test_failing_gates_lists_only_failures() -> None:
    body = _gem_body()
    body["regime"] = "bear"  # G7 fails
    gates = evaluate_gem_gates(_features(body))
    assert failing_gates(gates) == ["G7"]


def test_build_gem_why_is_non_advisory() -> None:
    f = _features(_gem_body())
    gates = evaluate_gem_gates(f, rs_bottom_quartile_threshold=-5.0)
    why = build_gem_why(f, gates, TIER_GEM)
    assert "Screening only" in why
    for banned in ("buy", "sell", "should own", "recommend"):
        assert banned not in why.lower()


def test_evaluate_does_not_mutate_body() -> None:
    body = _gem_body()
    snapshot = deepcopy(body)
    evaluate_gem_gates(_features(body))
    assert body == snapshot
