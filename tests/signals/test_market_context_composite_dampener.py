from __future__ import annotations

from stocvest.signals.composite_score import (
    CompositeSignal,
    CompositeVerdict,
    LayerContribution,
)
from stocvest.signals.market_context_composite_dampener import (
    apply_market_context_composite_dampening,
    technical_multiplier_for_listed_days,
)


def _composite(score: float = 0.4) -> CompositeSignal:
    contribs = [
        LayerContribution(
            layer="technical",
            raw_score=0.5,
            confidence=0.8,
            base_weight=0.3,
            regime_multiplier=1.0,
            effective_weight=0.24,
            weighted_value=0.12,
        ),
        LayerContribution(
            layer="sector",
            raw_score=0.6,
            confidence=0.8,
            base_weight=0.12,
            regime_multiplier=1.0,
            effective_weight=0.096,
            weighted_value=0.0576,
        ),
        LayerContribution(
            layer="internals",
            raw_score=0.4,
            confidence=0.8,
            base_weight=0.12,
            regime_multiplier=1.0,
            effective_weight=0.096,
            weighted_value=0.0384,
        ),
    ]
    return CompositeSignal(
        score=score,
        confidence=0.8,
        verdict=CompositeVerdict.BULLISH,
        contributions=contribs,
        alignment_ratio=0.9,
    )


def test_no_dampening_without_flags() -> None:
    comp = _composite()
    out, meta = apply_market_context_composite_dampening(
        comp, None, bullish_threshold=0.2, bearish_threshold=-0.2
    )
    assert meta is None
    assert out.score == comp.score


def test_index_window_dampens_sector_and_internals() -> None:
    comp = _composite()
    flags = {"index_inclusion_window": True, "warnings": ["Index inclusion window"]}
    out, meta = apply_market_context_composite_dampening(
        comp, flags, bullish_threshold=0.2, bearish_threshold=-0.2
    )
    assert meta is not None
    assert meta["active"] is True
    assert meta["confidence_level"] == "reduced"
    assert meta["undampened_score"] == 70
    layers = {d["layer"]: d for d in meta["dampened_layers"]}
    assert "sector" in layers
    assert "internals" in layers
    assert layers["sector"]["multiplier"] == 0.55
    sector_before = next(c for c in comp.contributions if c.layer == "sector")
    sector_after = next(c for c in out.contributions if c.layer == "sector")
    assert sector_after.effective_weight < sector_before.effective_weight


def test_backer_dampening_only_during_index_window_not_roadshow() -> None:
    comp = _composite()
    roadshow_only = {
        "ecosystem_role": "corporate_backer",
        "warnings": ["Anthropic IPO roadshow window — news may mix stake repricing"],
    }
    _, meta = apply_market_context_composite_dampening(
        comp, roadshow_only, bullish_threshold=0.2, bearish_threshold=-0.2
    )
    assert meta is None

    inclusion = {
        "index_inclusion_window": True,
        "ecosystem_role": "corporate_backer",
        "ecosystem_entity": "SpaceX",
    }
    _, meta2 = apply_market_context_composite_dampening(
        comp, inclusion, bullish_threshold=0.2, bearish_threshold=-0.2
    )
    assert meta2 is not None
    layers = {d["layer"]: d for d in meta2["dampened_layers"]}
    assert layers["sector"]["multiplier"] == 0.70


def test_technical_tier_by_listed_days() -> None:
    assert technical_multiplier_for_listed_days(5) == 0.30
    assert technical_multiplier_for_listed_days(20) == 0.50
    assert technical_multiplier_for_listed_days(45) == 0.65
    assert technical_multiplier_for_listed_days(80) == 0.80
    assert technical_multiplier_for_listed_days(100) is None
