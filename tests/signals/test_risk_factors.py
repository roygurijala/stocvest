from __future__ import annotations

from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.signals.composite_score import CompositeScoreEngine, CompositeSignal, CompositeVerdict, LayerSignal


def _base(payload: dict[str, object]) -> dict[str, object]:
    comp = CompositeScoreEngine().compute(
        [
            LayerSignal("technical", -1.0, 1.0),
            LayerSignal("geopolitical", -1.0, 1.0),
            LayerSignal("news", 1.0, 1.0),
            LayerSignal("macro", 1.0, 1.0),
            LayerSignal("sector", 1.0, 1.0),
            LayerSignal("internals", 1.0, 1.0),
        ],
        regime="sideways",
    )
    return build_swing_composite_evidence_fields(composite=comp, regime="sideways", payload=payload, confluence=None, snapshot={"last_trade_price": 100.0})


def test_geo_risk_generates_risk_factor() -> None:
    out = _base({"geopolitical_verdict": "bearish", "geo_high_impact_count": 3})
    assert any("Geopolitical" in x for x in out["risk_factors"])


def test_ema_conflict_generates_risk_factor() -> None:
    out = _base({"ema_conflict": True})
    assert any("EMA Stack Conflict" in x for x in out["risk_factors"])


def test_low_rr_generates_risk_factor() -> None:
    comp = CompositeScoreEngine().compute([LayerSignal("technical", 0.0, 0.0)], regime="sideways")
    out = build_swing_composite_evidence_fields(composite=comp, regime="sideways", payload={}, confluence=None, snapshot={"last_trade_price": 100.0})
    assert any("Low Risk/Reward" in x for x in out["risk_factors"])


def test_layer_contradiction_generates_risk_factor() -> None:
    comp = CompositeSignal(
        score=-0.6,
        confidence=1.0,
        verdict=CompositeVerdict.BEARISH,
        contributions=[],
        alignment_ratio=0.4,
        conflicted_layers=["news", "macro", "sector", "internals"],
        aligned_weight=2.5,
        conflicted_weight=4.0,
    )
    out = build_swing_composite_evidence_fields(composite=comp, regime="sideways", payload={}, confluence=None, snapshot={"last_trade_price": 100.0})
    assert any("Conflicted Signal" in x for x in out["risk_factors"])


def test_no_risk_factors_when_clean_signal() -> None:
    comp = CompositeScoreEngine().compute([LayerSignal("technical", 0.9, 1.0), LayerSignal("news", 0.8, 1.0)], regime="sideways")
    out = build_swing_composite_evidence_fields(composite=comp, regime="sideways", payload={}, confluence=None, snapshot={"last_trade_price": 100.0, "day_low": 99.0, "day_high": 101.0, "day_vwap": 100.0})
    assert out["risk_factors"] == ["No significant risk factors detected"]


def test_stale_layer_generates_low_severity_factor() -> None:
    out = _base({"stale_layers": [{"name": "Macro", "minutes_ago": 180}]})
    assert any("Stale Layer Data" in x for x in out["risk_factors"])
