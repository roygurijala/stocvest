from __future__ import annotations

from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal


def _evidence() -> dict[str, object]:
    comp = CompositeScoreEngine().compute([LayerSignal("technical", 0.0, 0.0)], regime="sideways")
    return build_swing_composite_evidence_fields(composite=comp, regime="sideways", payload={}, confluence=None, snapshot={"last_trade_price": 100.0})


def test_rr_below_2_sets_warning_flag() -> None:
    out = _evidence()
    assert out["risk_reward"] < 2.0
    assert out["rr_warning"] is True


def test_rr_below_2_applies_score_penalty() -> None:
    out = _evidence()
    assert int(out["signal_score"]) <= 40


def test_rr_quality_bands_correct() -> None:
    out = _evidence()
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
