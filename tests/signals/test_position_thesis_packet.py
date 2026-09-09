"""Unit tests for the Position thesis packet builder (POS-AI-1)."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from stocvest.signals.position_thesis_packet import (
    build_position_thesis_packet,
    deterministic_investment_read,
)

pytestmark = pytest.mark.unit


_LABELS = {
    "F1": "Profitability & quality",
    "F2": "Growth",
    "F3": "Balance sheet & solvency",
    "F4": "Valuation",
    "F5": "Earnings quality & consistency",
}


def _pillar(pid: str, score: int | None, verdict: str, *, dq: str = "high", status: str = "active", reasoning: str = "") -> dict[str, Any]:
    return {
        "pillar_id": pid,
        "label": _LABELS[pid],
        "score": score,
        "verdict": verdict,
        "reasoning": reasoning or f"{_LABELS[pid]} read {score}/100.",
        "data_quality": dq,
        "status": status,
        "chips": [],
    }


def _body(**over: Any) -> dict[str, Any]:
    body = {
        "symbol": "AAPL",
        "verdict": "bullish",
        "parameter_version": "v1",
        "position_fundamentals": {
            "score": 78,
            "verdict": "bullish",
            "data_quality": "high",
            "weakest_pillar_id": "F4",
            "pillars": [
                _pillar("F1", 82, "bullish"),
                _pillar("F2", 74, "bullish"),
                _pillar("F3", 70, "neutral"),
                _pillar("F4", 48, "neutral"),
                _pillar("F5", 72, "bullish"),
            ],
        },
        "layers": [
            {"layer": "fundamentals", "score": 78, "verdict": "bullish", "status": "active"},
            {"layer": "technical", "score": 66, "verdict": "bullish", "status": "available", "reasoning": "Weekly uptrend above SMA200."},
            {"layer": "sector", "score": 44, "verdict": "bearish", "status": "available", "reasoning": "Sector lagging SPY."},
            {"layer": "macro", "score": 52, "verdict": "neutral", "status": "available"},
        ],
    }
    body.update(over)
    return body


def _sources(bullets) -> list[str]:
    return [b.source for b in bullets]


def test_bull_case_cites_bullish_pillars_and_layers() -> None:
    packet = build_position_thesis_packet(_body())
    srcs = _sources(packet.bull_case)
    assert "F1" in srcs and "F2" in srcs and "F5" in srcs
    assert "layer:technical" in srcs


def test_bear_case_cites_bearish_layer_and_weakest_pillar() -> None:
    packet = build_position_thesis_packet(_body())
    srcs = _sources(packet.bear_case)
    assert "layer:sector" in srcs  # bearish sector
    assert "F4" in srcs  # weakest pillar surfaced even though neutral


def test_every_bullet_has_a_source_and_confidence() -> None:
    packet = build_position_thesis_packet(_body())
    allb = packet.bull_case + packet.bear_case + packet.open_questions
    assert allb
    for b in allb:
        assert b.source
        assert b.confidence in ("high", "medium", "low")


def test_value_trap_open_question_when_f4_not_bullish_but_quality_is() -> None:
    packet = build_position_thesis_packet(_body())
    texts = " ".join(q.text for q in packet.open_questions).lower()
    assert "valuation" in texts and "entry price" in texts


def test_classifies_by_verdict_not_raw_score() -> None:
    # F3 downgraded to neutral (balance-sheet red flag) despite a high score: must NOT be a bull.
    b = _body()
    b["position_fundamentals"]["pillars"][2] = _pillar("F3", 68, "neutral")
    packet = build_position_thesis_packet(b)
    assert "F3" not in _sources(packet.bull_case)
    assert "F3" not in _sources(packet.bear_case)


def test_value_trap_downgrade_not_in_bull_and_question_fires() -> None:
    # F4 capped/downgraded to neutral with a high-ish score while F1/F2 bullish.
    b = _body()
    b["position_fundamentals"]["pillars"][3] = _pillar("F4", 64, "neutral")
    packet = build_position_thesis_packet(b)
    assert "F4" not in _sources(packet.bull_case)
    texts = " ".join(q.text for q in packet.open_questions).lower()
    assert "entry price" in texts


def test_no_value_trap_question_when_f4_bullish() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"][3] = _pillar("F4", 70, "bullish")
    packet = build_position_thesis_packet(b)
    texts = " ".join(q.text for q in packet.open_questions).lower()
    assert "entry price" not in texts


def test_unavailable_pillar_becomes_open_question_not_bull() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"][1] = _pillar("F2", None, "neutral", status="unavailable", dq="unavailable")
    packet = build_position_thesis_packet(b)
    assert "F2" not in _sources(packet.bull_case)
    assert any(q.source == "F2" for q in packet.open_questions)


def test_missing_pillar_row_becomes_open_question() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"] = b["position_fundamentals"]["pillars"][:4]  # drop F5
    packet = build_position_thesis_packet(b)
    assert any(q.source == "F5" for q in packet.open_questions)


def test_low_data_quality_pillar_raises_question() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"][0] = _pillar("F1", 82, "bullish", dq="low")
    packet = build_position_thesis_packet(b)
    assert any(q.source == "F1" and "data quality" in q.text.lower() for q in packet.open_questions)


def test_bearish_pillar_goes_to_bear_case() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"][2] = _pillar("F3", 30, "bearish")
    b["position_fundamentals"]["weakest_pillar_id"] = "F3"
    packet = build_position_thesis_packet(b)
    assert "F3" in _sources(packet.bear_case)


def test_degraded_layer_is_not_narrated() -> None:
    b = _body()
    b["layers"][1] = {"layer": "technical", "score": 66, "verdict": "bullish", "status": "degraded"}
    packet = build_position_thesis_packet(b)
    assert "layer:technical" not in _sources(packet.bull_case)


def test_no_contradiction_adds_invalidation_question() -> None:
    b = _body()
    # Remove bearish sector and weakest-pillar bear source so bear_case is empty.
    b["layers"][2] = {"layer": "sector", "score": 55, "verdict": "neutral", "status": "available"}
    b["position_fundamentals"]["weakest_pillar_id"] = None
    packet = build_position_thesis_packet(b)
    assert packet.bear_case == []
    assert any("invalidate" in q.text.lower() for q in packet.open_questions)


def test_insufficient_data_body() -> None:
    packet = build_position_thesis_packet(
        {"symbol": "ZZZ", "status": "insufficient_data", "position_fundamentals": {"pillars": []}}
    )
    assert packet.bull_case == [] and packet.bear_case == []
    assert len(packet.open_questions) == 1
    assert packet.pillar_snapshot_hash


def test_hash_is_stable_and_score_sensitive() -> None:
    h1 = build_position_thesis_packet(_body()).pillar_snapshot_hash
    h2 = build_position_thesis_packet(_body()).pillar_snapshot_hash
    assert h1 == h2 and len(h1) == 16
    b = _body()
    b["position_fundamentals"]["pillars"][0] = _pillar("F1", 90, "bullish")
    assert build_position_thesis_packet(b).pillar_snapshot_hash != h1


def test_confidence_scales_with_quality_and_strength() -> None:
    b = _body()
    b["position_fundamentals"]["pillars"][0] = _pillar("F1", 85, "bullish", dq="high")  # strong+high -> high
    b["position_fundamentals"]["pillars"][1] = _pillar("F2", 64, "bullish", dq="low")  # weak+low -> low
    packet = build_position_thesis_packet(b)
    by_src = {x.source: x.confidence for x in packet.bull_case}
    assert by_src.get("F1") == "high"
    assert by_src.get("F2") == "low"


def test_sections_capped_and_deduped() -> None:
    packet = build_position_thesis_packet(_body())
    assert len(packet.bull_case) <= 6
    assert len(packet.bear_case) <= 6
    assert len(packet.open_questions) <= 6
    for section in (packet.bull_case, packet.bear_case, packet.open_questions):
        keys = [(b.source, b.text) for b in section]
        assert len(keys) == len(set(keys))


def test_builder_does_not_mutate_body() -> None:
    b = _body()
    snap = deepcopy(b)
    build_position_thesis_packet(b)
    assert b == snap


def test_deterministic_read_is_non_advisory() -> None:
    read = deterministic_investment_read(build_position_thesis_packet(_body()))
    assert read.endswith("Signal data only.")
    assert "Position desk" in read
    for banned in ("buy", "sell", "should own", "allocate"):
        assert banned not in read.lower()


def test_to_api_dict_shape() -> None:
    d = build_position_thesis_packet(_body()).to_api_dict()
    assert set(d) == {"symbol", "verdict", "bull_case", "bear_case", "open_questions", "pillar_snapshot_hash"}
    assert all(set(b) == {"text", "source", "confidence"} for b in d["bull_case"])
