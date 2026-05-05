from __future__ import annotations

from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal


def test_conflicted_signal_receives_contradiction_penalty() -> None:
    engine = CompositeScoreEngine()
    result = engine.compute(
        [
            LayerSignal("technical", -1.0, 1.0),
            LayerSignal("geopolitical", -1.0, 1.0),
            LayerSignal("news", -1.0, 1.0),
            LayerSignal("macro", -1.0, 1.0),
            LayerSignal("sector", 1.0, 1.0),
            LayerSignal("internals", 1.0, 1.0),
        ],
        regime="sideways",
    )
    assert result.alignment_ratio < 0.85
    assert result.score < 0
    assert abs(result.score) < 0.5


def test_aligned_signal_receives_no_penalty() -> None:
    engine = CompositeScoreEngine()
    result = engine.compute(
        [LayerSignal("technical", 0.9, 1.0), LayerSignal("news", 0.8, 1.0), LayerSignal("macro", 0.7, 1.0)],
        regime="sideways",
    )
    assert result.alignment_ratio >= 0.85
    assert "technical" not in (result.conflicted_layers or [])


def test_technical_layer_has_higher_alignment_weight() -> None:
    engine = CompositeScoreEngine()
    result = engine.compute(
        [LayerSignal("technical", 1.0, 1.0), LayerSignal("news", -1.0, 1.0)],
        regime="sideways",
    )
    assert result.aligned_weight == 1.5
    assert result.conflicted_weight == 1.0
    assert result.alignment_ratio == 0.6


def test_alignment_ratio_stored_on_signal() -> None:
    result = CompositeScoreEngine().compute([LayerSignal("technical", 1.0, 1.0)], regime="sideways")
    assert isinstance(result.alignment_ratio, float)
    assert result.alignment_ratio == 1.0


def test_score_100_impossible_when_majority_layers_conflict() -> None:
    result = CompositeScoreEngine().compute(
        [
            LayerSignal("technical", -1.0, 1.0),
            LayerSignal("geopolitical", -1.0, 1.0),
            LayerSignal("news", 1.0, 1.0),
            LayerSignal("macro", 1.0, 1.0),
            LayerSignal("sector", 1.0, 1.0),
        ],
        regime="sideways",
    )
    score_0_100 = int(round((result.score + 1.0) * 50.0))
    assert score_0_100 < 100


def test_neutral_net_score_uses_plurality_alignment_not_perfect() -> None:
    """Neutral verdict must not imply 100% layer agreement when directions split."""
    result = CompositeScoreEngine().compute(
        [
            LayerSignal("technical", 1.0, 1.0),
            LayerSignal("news", 1.0, 1.0),
            LayerSignal("macro", -1.0, 1.0),
            LayerSignal("sector", -1.0, 1.0),
            LayerSignal("geopolitical", 0.0, 1.0),
            LayerSignal("internals", 0.0, 1.0),
        ],
        regime="sideways",
    )
    assert result.verdict.value == "neutral"
    assert result.alignment_ratio < 0.55
    assert len(result.conflicted_layers) >= 3
