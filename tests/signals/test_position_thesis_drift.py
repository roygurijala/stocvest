"""Unit tests for informational Position thesis drift (ADR-004 POS-AI-7)."""

from __future__ import annotations

import json

import pytest

from stocvest.signals.position_thesis_drift import (
    build_pillar_snapshot,
    compute_pillar_drift,
    pillar_snapshot_to_json,
)

pytestmark = pytest.mark.unit


def _body(verdict: str, pillars: list[tuple[str, int | None, str]], *, symbol: str = "AAPL") -> dict:
    return {
        "symbol": symbol,
        "verdict": verdict,
        "position_fundamentals": {
            "pillars": [
                {"pillar_id": pid, "label": f"{pid} label", "score": score, "verdict": pv}
                for pid, score, pv in pillars
            ]
        },
    }


def test_build_snapshot_and_json() -> None:
    body = _body("bullish", [("F1", 80, "bullish"), ("F4", 40, "bearish")])
    snap = build_pillar_snapshot(body)
    assert snap["verdict"] == "bullish"
    assert snap["pillars"] == {
        "F1": {"score": 80, "verdict": "bullish"},
        "F4": {"score": 40, "verdict": "bearish"},
    }
    js = pillar_snapshot_to_json(body)
    assert js is not None and json.loads(js)["pillars"]["F1"]["score"] == 80


def test_snapshot_json_none_without_pillars() -> None:
    assert pillar_snapshot_to_json({"symbol": "X", "verdict": "neutral"}) is None
    assert pillar_snapshot_to_json({"position_fundamentals": {"pillars": []}}) is None


def test_no_baseline_returns_none() -> None:
    assert compute_pillar_drift(None, _body("bullish", [("F1", 80, "bullish")])) is None
    assert compute_pillar_drift("not-json", _body("bullish", [("F1", 80, "bullish")])) is None


def test_identical_snapshot_has_no_drift() -> None:
    body = _body("bullish", [("F1", 80, "bullish"), ("F2", 60, "neutral")])
    base = pillar_snapshot_to_json(body)
    res = compute_pillar_drift(base, body)
    assert res is not None
    assert res.has_drift is False
    assert res.verdict_downgraded is False
    assert res.degraded_pillars == []


def test_overall_verdict_downgrade_flags_drift() -> None:
    base = pillar_snapshot_to_json(_body("bullish", [("F1", 80, "bullish")]))
    cur = _body("neutral", [("F1", 80, "bullish")])
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.verdict_downgraded is True
    assert res.has_drift is True
    assert res.verdict_from == "bullish" and res.verdict_to == "neutral"


def test_pillar_score_drop_flags_degraded() -> None:
    base = pillar_snapshot_to_json(_body("bullish", [("F1", 80, "bullish"), ("F2", 60, "neutral")]))
    cur = _body("bullish", [("F1", 62, "bullish"), ("F2", 60, "neutral")])  # F1 -18
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.has_drift is True
    ids = [p.pillar_id for p in res.degraded_pillars]
    assert ids == ["F1"]
    assert res.degraded_pillars[0].from_score == 80
    assert res.degraded_pillars[0].to_score == 62
    assert any("score" in r for r in res.degraded_pillars[0].reasons)


def test_small_score_drop_below_threshold_is_not_drift() -> None:
    base = pillar_snapshot_to_json(_body("bullish", [("F1", 80, "bullish")]))
    cur = _body("bullish", [("F1", 70, "bullish")])  # -10, below default 15
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.has_drift is False


def test_pillar_verdict_downgrade_flags_degraded() -> None:
    base = pillar_snapshot_to_json(_body("bullish", [("F3", 55, "bullish")]))
    cur = _body("bullish", [("F3", 55, "bearish")])
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.has_drift is True
    assert res.degraded_pillars[0].pillar_id == "F3"
    assert any("verdict" in r for r in res.degraded_pillars[0].reasons)


def test_improvement_is_not_drift() -> None:
    base = pillar_snapshot_to_json(_body("neutral", [("F1", 60, "neutral")]))
    cur = _body("bullish", [("F1", 90, "bullish")])
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.has_drift is False
    assert res.verdict_downgraded is False


def test_pillar_absent_in_current_is_skipped() -> None:
    base = pillar_snapshot_to_json(_body("bullish", [("F1", 80, "bullish"), ("F4", 40, "bearish")]))
    cur = _body("bullish", [("F1", 80, "bullish")])  # F4 missing now
    res = compute_pillar_drift(base, cur)
    assert res is not None
    assert res.has_drift is False  # F4 can't be assessed → not counted as drift


def test_baseline_accepts_dict_and_json_string() -> None:
    body = _body("bullish", [("F1", 80, "bullish")])
    snap_dict = build_pillar_snapshot(body)
    cur = _body("bearish", [("F1", 80, "bullish")])
    from_dict = compute_pillar_drift(snap_dict, cur)
    from_json = compute_pillar_drift(json.dumps(snap_dict), cur)
    assert from_dict is not None and from_json is not None
    assert from_dict.verdict_downgraded is True and from_json.verdict_downgraded is True
