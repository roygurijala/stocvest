from __future__ import annotations

from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal

# Bullish verdict + session range so T1 R/R stays between 1:1 and 2:1 (T2 extension
# no longer applies). Minimal last-only snapshots now resolve to ~2:1 via 2R geometry.
_LOW_RR_SNAPSHOT = {
    "last_trade_price": 100.0,
    "day_low": 95.0,
    "day_high": 106.0,
}


def _low_rr_evidence() -> dict[str, object]:
    comp = CompositeScoreEngine().compute([LayerSignal("technical", 0.9, 1.0)], regime="sideways")
    return build_swing_composite_evidence_fields(
        composite=comp,
        regime="sideways",
        payload={},
        confluence=None,
        snapshot=_LOW_RR_SNAPSHOT,
    )


def test_rr_below_2_sets_warning_flag() -> None:
    out = _low_rr_evidence()
    assert out["risk_reward"] < 2.0
    assert out["rr_warning"] is True


def test_rr_below_2_applies_score_penalty() -> None:
    out = _low_rr_evidence()
    base_score = int(round((0.9 + 1.0) / 2.0 * 100.0))
    assert out["rr_warning"] is True
    assert int(out["signal_score"]) == int(round(base_score * 0.8))


def test_rr_quality_bands_correct() -> None:
    out = _low_rr_evidence()
    assert out["rr_quality"] == "low"


def test_rr_warning_false_when_above_2() -> None:
    comp = CompositeScoreEngine().compute([LayerSignal("technical", 0.9, 1.0)], regime="sideways")
    out = build_swing_composite_evidence_fields(
        composite=comp,
        regime="sideways",
        payload={},
        confluence=None,
        snapshot={
            "last_trade_price": 100.0,
            "day_high": 106.0,
            "day_low": 99.0,
            "day_vwap": 99.5,
        },
    )
    assert isinstance(out["rr_warning"], bool)
    assert out["risk_reward"] >= 2.0
    assert out["rr_warning"] is False
