from __future__ import annotations

from dataclasses import replace

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.signals.composite_score import (
    DEFAULT_BASE_WEIGHTS,
    CompositeScoreEngine,
    CompositeVerdict,
    LayerSignal,
    build_composite_score_engine_from_params,
)


@pytest.mark.unit
def test_empty_signals_returns_neutral_zero():
    engine = CompositeScoreEngine()
    result = engine.compute([])
    assert result.score == pytest.approx(0.0)
    assert result.confidence == pytest.approx(0.0)
    assert result.verdict == CompositeVerdict.NEUTRAL


@pytest.mark.unit
def test_positive_weighted_score_returns_bullish():
    engine = CompositeScoreEngine()
    signals = [
        LayerSignal(layer="technical", score=0.8, confidence=0.9),
        LayerSignal(layer="news", score=0.6, confidence=0.8),
        LayerSignal(layer="macro", score=0.4, confidence=0.7),
    ]
    result = engine.compute(signals, regime="bull")
    assert result.score > 0.2
    assert result.verdict == CompositeVerdict.BULLISH
    assert result.confidence > 0.0


@pytest.mark.unit
def test_negative_weighted_score_returns_bearish():
    engine = CompositeScoreEngine()
    signals = [
        LayerSignal(layer="technical", score=-0.6, confidence=0.9),
        LayerSignal(layer="geopolitical", score=-0.8, confidence=0.9),
        LayerSignal(layer="macro", score=-0.5, confidence=0.8),
    ]
    result = engine.compute(signals, regime="bear")
    assert result.score < -0.2
    assert result.verdict == CompositeVerdict.BEARISH


@pytest.mark.unit
def test_unknown_layer_has_no_weight_by_default():
    engine = CompositeScoreEngine()
    signals = [LayerSignal(layer="mystery", score=1.0, confidence=1.0)]
    result = engine.compute(signals)
    assert result.score == pytest.approx(0.0)
    assert result.confidence == pytest.approx(0.0)
    assert result.verdict == CompositeVerdict.NEUTRAL


@pytest.mark.unit
def test_score_and_confidence_are_clamped():
    engine = CompositeScoreEngine()
    signals = [
        LayerSignal(layer="technical", score=9.0, confidence=2.5),
        LayerSignal(layer="news", score=-9.0, confidence=-1.0),
    ]
    result = engine.compute(signals)
    assert -1.0 <= result.score <= 1.0
    assert 0.0 <= result.confidence <= 1.0


@pytest.mark.unit
def test_sideways_regime_used_when_unknown_regime_requested():
    engine = CompositeScoreEngine()
    signals = [LayerSignal(layer="technical", score=0.5, confidence=1.0)]
    unknown = engine.compute(signals, regime="unknown-regime")
    sideways = engine.compute(signals, regime="sideways")
    assert unknown.score == pytest.approx(sideways.score)
    assert unknown.confidence == pytest.approx(sideways.confidence)


@pytest.mark.unit
def test_confidence_uses_weighted_average_not_squared_effect():
    engine = CompositeScoreEngine(
        base_weights={"technical": 0.5, "news": 0.5},
        regime_weights={"sideways": {"technical": 1.0, "news": 1.0}},
    )
    result = engine.compute(
        [
            LayerSignal(layer="technical", score=0.5, confidence=1.0),
            LayerSignal(layer="news", score=0.5, confidence=0.5),
        ],
        regime="sideways",
    )
    # weighted average confidence = (0.5*1.0 + 0.5*0.5) / (0.5+0.5) = 0.75
    assert result.confidence == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# D3 — parameter-store wiring lock-ins
# ---------------------------------------------------------------------------
#
# These tests pin the single seam between :class:`SignalParameters` and a live
# :class:`CompositeScoreEngine`. They are the regression guard that prevents the
# legacy ``DEFAULT_BASE_WEIGHTS`` constants from creeping back into production
# scoring paths and silently making the ``parameter_version`` stamped on every
# :class:`SignalRecord` a lie.


@pytest.mark.unit
def test_helper_uses_composite_params_weights_not_legacy_defaults():
    """Lock in that the helper reads `params.composite.*_weight`, not DEFAULT_BASE_WEIGHTS.

    The two dictionaries differ on news / sector / macro / geopolitical / internals.
    If anyone re-imports DEFAULT_BASE_WEIGHTS into a production codepath, this
    test fails loud.
    """
    params = default_signal_parameters()
    engine = build_composite_score_engine_from_params(params)
    assert engine._base_weights == {
        "technical": pytest.approx(params.composite.technical_weight),
        "news": pytest.approx(params.composite.news_weight),
        "macro": pytest.approx(params.composite.macro_weight),
        "sector": pytest.approx(params.composite.sector_weight),
        "geopolitical": pytest.approx(params.composite.geopolitical_weight),
        "internals": pytest.approx(params.composite.internals_weight),
    }
    # And explicitly NOT the legacy constants — these differ on at least
    # news (0.18 vs 0.20), sector (0.12 vs 0.15), macro (0.16 vs 0.15).
    assert engine._base_weights["news"] != pytest.approx(DEFAULT_BASE_WEIGHTS["news"])
    assert engine._base_weights["sector"] != pytest.approx(DEFAULT_BASE_WEIGHTS["sector"])
    assert engine._base_weights["macro"] != pytest.approx(DEFAULT_BASE_WEIGHTS["macro"])


@pytest.mark.unit
def test_helper_threads_thresholds_from_params():
    """Bullish / bearish thresholds come from params.composite, not engine defaults."""
    params = default_signal_parameters()
    custom_composite = replace(params.composite, bullish_threshold=0.42, bearish_threshold=-0.42)
    custom_params = replace(params, composite=custom_composite)
    engine = build_composite_score_engine_from_params(custom_params)
    assert engine._bullish_threshold == pytest.approx(0.42)
    assert engine._bearish_threshold == pytest.approx(-0.42)


@pytest.mark.unit
def test_changing_params_actually_changes_engine_output():
    """End-to-end: bumping a weight in SignalParameters must move the composite score.

    This is the wire-is-live test. If someone refactors the helper to silently
    fall back to DEFAULT_BASE_WEIGHTS, the two scores below would be equal and
    this test would fail.
    """
    baseline_params = default_signal_parameters()
    signals = [
        LayerSignal(layer="technical", score=1.0, confidence=1.0),
        LayerSignal(layer="news", score=-1.0, confidence=1.0),
        LayerSignal(layer="macro", score=0.0, confidence=1.0),
    ]
    baseline = build_composite_score_engine_from_params(baseline_params).compute(
        signals, regime="sideways"
    )

    # Crank technical up and news down — the bullish tilt of the score must increase.
    tuned_composite = replace(
        baseline_params.composite,
        technical_weight=0.60,
        news_weight=0.05,
        macro_weight=0.10,
        sector_weight=0.10,
        geopolitical_weight=0.10,
        internals_weight=0.05,
    )
    tuned_params = replace(baseline_params, composite=tuned_composite)
    tuned = build_composite_score_engine_from_params(tuned_params).compute(
        signals, regime="sideways"
    )

    assert tuned.score > baseline.score
    # And the verdict should have flipped from neutral toward bullish.
    assert baseline.verdict == CompositeVerdict.NEUTRAL
    assert tuned.verdict == CompositeVerdict.BULLISH


@pytest.mark.unit
def test_helper_coerces_int_weights_to_float():
    """Operators editing JSON in Secrets Manager may store integer weights.

    The helper must not crash on `technical_weight: 1` (int) — coerce to float.
    """
    params = default_signal_parameters()
    int_composite = replace(
        params.composite,
        technical_weight=1,  # type: ignore[arg-type]
        news_weight=0,  # type: ignore[arg-type]
        macro_weight=0,  # type: ignore[arg-type]
        sector_weight=0,  # type: ignore[arg-type]
        geopolitical_weight=0,  # type: ignore[arg-type]
        internals_weight=0,  # type: ignore[arg-type]
    )
    int_params = replace(params, composite=int_composite)
    engine = build_composite_score_engine_from_params(int_params)
    for value in engine._base_weights.values():
        assert isinstance(value, float)
    assert isinstance(engine._bullish_threshold, float)
    assert isinstance(engine._bearish_threshold, float)
