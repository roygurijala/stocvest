from __future__ import annotations

import pytest

from stocvest.signals.composite_score import (
    CompositeScoreEngine,
    CompositeVerdict,
    LayerSignal,
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
