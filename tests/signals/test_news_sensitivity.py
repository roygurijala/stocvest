"""B71 Phase A — per-symbol News/Geo sensitivity weighting.

Covers the static sector-prior resolver (``news_sensitivity``) and its wiring
into ``CompositeScoreEngine.compute`` as a down-only, renormalizing, non-gating
influence multiplier.
"""

from __future__ import annotations

import pytest

from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal
from stocvest.signals.news_sensitivity import (
    SENSITIVITY_CEILING,
    SENSITIVITY_FLOOR,
    SensitivityBand,
    layer_sensitivity_bands,
    layer_sensitivity_multipliers,
    layer_sensitivity_payload,
)


class _FakeRef:
    def __init__(self, is_adr: bool) -> None:
        self._is_adr = is_adr

    def is_adr(self) -> bool:
        return self._is_adr


@pytest.mark.unit
def test_low_sensitivity_sector_downweights_news_and_geo():
    bands = layer_sensitivity_bands("utilities")
    assert bands["news"] == SensitivityBand.LOW
    assert bands["geopolitical"] == SensitivityBand.LOW
    mult = layer_sensitivity_multipliers("utilities")
    assert mult["news"] < 1.0
    assert mult["geopolitical"] < 1.0


@pytest.mark.unit
def test_payload_exposes_bands_and_multipliers_for_ui():
    payload = layer_sensitivity_payload("utilities")
    assert payload["sic_bucket"] == "utilities"
    assert payload["news"]["band"] == "low"
    assert payload["news"]["multiplier"] < 1.0
    assert payload["geopolitical"]["band"] == "low"
    # Unknown sector renders neutral (HIGH / 1.0) so the UI matches pre-B71 behavior.
    neutral = layer_sensitivity_payload(None)
    assert neutral["sic_bucket"] == "default"
    assert neutral["news"] == {"band": "high", "multiplier": 1.0}
    assert neutral["geopolitical"] == {"band": "high", "multiplier": 1.0}


@pytest.mark.unit
def test_medium_news_sector_partial_downweight():
    bands = layer_sensitivity_bands("financials")
    assert bands["news"] == SensitivityBand.MEDIUM
    # financials carry high geo exposure (rates / EM) → kept at full weight
    assert bands["geopolitical"] == SensitivityBand.HIGH
    mult = layer_sensitivity_multipliers("financials")
    assert 0.6 < mult["news"] < 1.0
    assert mult["geopolitical"] == pytest.approx(1.0)


@pytest.mark.unit
def test_unknown_sector_is_neutral():
    # Anything we cannot classify must behave exactly like pre-B71 (1.0/1.0).
    for bucket in ("", "default", "something_weird", None):
        mult = layer_sensitivity_multipliers(bucket)
        assert mult == {"news": 1.0, "geopolitical": 1.0}


@pytest.mark.unit
def test_high_news_sector_keeps_full_weight():
    # Biotech / semis are headline-driven → no down-weight on news.
    assert layer_sensitivity_multipliers("biotech")["news"] == pytest.approx(1.0)
    assert layer_sensitivity_multipliers("semiconductors")["news"] == pytest.approx(1.0)


@pytest.mark.unit
def test_adr_keeps_full_geo_weight_even_in_low_geo_sector():
    # software maps to LOW geo, but an ADR carries home-country geo risk.
    domestic = layer_sensitivity_multipliers("software")
    adr = layer_sensitivity_multipliers("software", ticker_ref=_FakeRef(is_adr=True))
    assert domestic["geopolitical"] < 1.0
    assert adr["geopolitical"] == pytest.approx(1.0)


@pytest.mark.unit
def test_multipliers_stay_within_guardrail_band():
    for bucket in ("utilities", "financials", "energy", "real_estate", "technology", "unknownx"):
        mult = layer_sensitivity_multipliers(bucket)
        for value in mult.values():
            assert SENSITIVITY_FLOOR <= value <= SENSITIVITY_CEILING


@pytest.mark.unit
def test_bad_ticker_ref_does_not_break_resolution():
    class _Broken:
        def is_adr(self):  # noqa: ANN001
            raise RuntimeError("boom")

    mult = layer_sensitivity_multipliers("software", ticker_ref=_Broken())
    # Falls back to non-ADR path rather than raising.
    assert mult["geopolitical"] < 1.0


# ── Engine integration ────────────────────────────────────────────────────────


def _signals() -> list[LayerSignal]:
    return [
        LayerSignal(layer="technical", score=0.6, confidence=1.0),
        LayerSignal(layer="news", score=0.9, confidence=1.0),
        LayerSignal(layer="geopolitical", score=0.9, confidence=1.0),
        LayerSignal(layer="macro", score=-0.2, confidence=1.0),
    ]


@pytest.mark.unit
def test_engine_default_matches_no_multiplier():
    engine = CompositeScoreEngine()
    baseline = engine.compute(_signals(), regime="sideways")
    explicit_neutral = engine.compute(
        _signals(), regime="sideways", sensitivity_multipliers={"news": 1.0, "geopolitical": 1.0}
    )
    assert baseline.score == pytest.approx(explicit_neutral.score)
    assert baseline.confidence == pytest.approx(explicit_neutral.confidence)


@pytest.mark.unit
def test_downweighting_news_reduces_its_contribution_and_renormalizes():
    engine = CompositeScoreEngine()
    baseline = engine.compute(_signals(), regime="sideways")
    downweighted = engine.compute(
        _signals(),
        regime="sideways",
        sensitivity_multipliers={"news": 0.6, "geopolitical": 0.6},
    )

    def _eff(result, layer):
        return next(c.effective_weight for c in result.contributions if c.layer == layer)

    # News/geo carry less effective weight when down-weighted...
    assert _eff(downweighted, "news") < _eff(baseline, "news")
    assert _eff(downweighted, "geopolitical") < _eff(baseline, "geopolitical")
    # ...while technical/macro effective weights are unchanged (no multiplier).
    assert _eff(downweighted, "technical") == pytest.approx(_eff(baseline, "technical"))
    assert _eff(downweighted, "macro") == pytest.approx(_eff(baseline, "macro"))
    # Bullish news/geo dragged the composite up; muting them lowers the score.
    assert downweighted.score < baseline.score


@pytest.mark.unit
def test_sensitivity_clamped_inside_engine():
    engine = CompositeScoreEngine()
    # Absurd multipliers must be clamped, not blow up the blend.
    result = engine.compute(
        _signals(),
        regime="sideways",
        sensitivity_multipliers={"news": 99.0, "geopolitical": -5.0},
    )
    assert -1.0 <= result.score <= 1.0
