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
    # base_weight × regime × confidence: technical 0.30, news 0.18 (sideways)
    assert result.aligned_weight == 0.3
    assert result.conflicted_weight == 0.18
    assert result.alignment_ratio == 0.3 / (0.3 + 0.18)


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


def test_bull_bear_alignment_uses_regime_weights() -> None:
    """Bear regime boosts geopolitical weight; when geo conflicts with bearish verdict, conflicted mass rises."""
    engine = CompositeScoreEngine()
    signals = [
        LayerSignal("technical", -1.0, 1.0),
        LayerSignal("geopolitical", 1.0, 1.0),
    ]
    sideways = engine.compute(signals, regime="sideways")
    bear = engine.compute(signals, regime="bear")
    assert sideways.verdict == bear.verdict  # both bearish
    assert bear.conflicted_weight > sideways.conflicted_weight


def test_alignment_ratio_consistent_neutral_vs_directional() -> None:
    """Tiny score change flips final verdict while layer directions stay fixed; alignment stays stable (~10%)."""
    engine = CompositeScoreEngine()
    neutral_final = [
        LayerSignal("technical", 1.0, 1.0),
        LayerSignal("news", 1.0, 1.0),
        LayerSignal("macro", -0.65, 1.0),
        LayerSignal("sector", -0.65, 1.0),
        LayerSignal("geopolitical", 0.0, 1.0),
        LayerSignal("internals", 0.0, 1.0),
    ]
    bullish_final = [
        LayerSignal("technical", 1.0, 1.0),
        LayerSignal("news", 1.0, 1.0),
        LayerSignal("macro", -0.6, 1.0),
        LayerSignal("sector", -0.6, 1.0),
        LayerSignal("geopolitical", 0.0, 1.0),
        LayerSignal("internals", 0.0, 1.0),
    ]
    r_neutral = engine.compute(neutral_final, regime="sideways")
    r_bull = engine.compute(bullish_final, regime="sideways")
    assert r_neutral.verdict.value == "neutral"
    assert r_bull.verdict.value == "bullish"
    assert abs(r_neutral.alignment_ratio - r_bull.alignment_ratio) <= 0.10


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
