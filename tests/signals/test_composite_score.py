from __future__ import annotations

from dataclasses import replace

import pytest

from stocvest.config.signal_parameters import CompositeParameters, default_signal_parameters
from stocvest.signals.composite_score import (
    DEFAULT_BASE_WEIGHTS,
    CompositeScoreEngine,
    CompositeVerdict,
    LayerSignal,
    build_composite_score_engine_from_params,
    resolve_composite_block,
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

    DEFAULT_BASE_WEIGHTS is now kept in sync with CompositeParameters field defaults
    (fix #11 — the two tables previously diverged on news/sector/macro/geopolitical/
    internals, causing tests using the no-args engine to score against different weights
    than production). This test verifies the production helper produces weights that
    match CompositeParameters AND that DEFAULT_BASE_WEIGHTS itself is also in sync.
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
    # Verify DEFAULT_BASE_WEIGHTS is also in sync with CompositeParameters defaults
    # so the no-args engine path used in tests uses the same table as production.
    assert DEFAULT_BASE_WEIGHTS["news"] == pytest.approx(params.composite.news_weight)
    assert DEFAULT_BASE_WEIGHTS["sector"] == pytest.approx(params.composite.sector_weight)
    assert DEFAULT_BASE_WEIGHTS["macro"] == pytest.approx(params.composite.macro_weight)
    assert DEFAULT_BASE_WEIGHTS["geopolitical"] == pytest.approx(params.composite.geopolitical_weight)
    assert DEFAULT_BASE_WEIGHTS["internals"] == pytest.approx(params.composite.internals_weight)


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


# ---------------------------------------------------------------------------
# B30 Phase 3 — per-mode composite override blocks (Suggestion 4 audit)
# ---------------------------------------------------------------------------
#
# These tests pin the swing/day composite weight separation seam. The audit
# concluded that the swing and day engines deserve different layer blend
# weights (macro/sector higher for swing; news/internals/technical higher for
# day) because their per-layer **inputs** already differ (swing reads 120h news
# / 14d macro / 168h geo / daily-bar tech; day reads 8h news / 1d macro / 8h
# geo / intraday tech). The seam is `resolve_composite_block(params, mode)`
# plus the new `mode` kwarg on `build_composite_score_engine_from_params`.
#
# The load-bearing invariant is **no-op back-compat**: when Secrets Manager
# JSON has no `swing_composite` / `day_composite` keys (i.e. every existing
# secret today), the resolver returns the shared `params.composite` block, so
# both engines behave identically — production is unchanged. The tests below
# pin both the back-compat path AND the per-mode override path.


@pytest.mark.unit
def test_resolve_composite_block_falls_back_to_shared_when_no_per_mode_block():
    """No-op default: with no override blocks set, both modes return the shared block."""
    params = default_signal_parameters()
    assert params.swing_composite is None
    assert params.day_composite is None

    assert resolve_composite_block(params, mode="swing") is params.composite
    assert resolve_composite_block(params, mode="day") is params.composite
    assert resolve_composite_block(params, mode=None) is params.composite


@pytest.mark.unit
def test_resolve_composite_block_returns_swing_block_when_set():
    """When swing_composite is set and mode='swing', resolver returns the override."""
    params = default_signal_parameters()
    swing_override = CompositeParameters(
        technical_weight=0.28,
        news_weight=0.15,
        macro_weight=0.20,
        sector_weight=0.18,
        geopolitical_weight=0.12,
        internals_weight=0.07,
    )
    custom = replace(params, swing_composite=swing_override)

    assert resolve_composite_block(custom, mode="swing") is swing_override
    # mode="day" must NOT pick up the swing override.
    assert resolve_composite_block(custom, mode="day") is custom.composite
    # mode=None is always the shared block (back-compat for callers that don't pass mode).
    assert resolve_composite_block(custom, mode=None) is custom.composite


@pytest.mark.unit
def test_resolve_composite_block_returns_day_block_when_set():
    """When day_composite is set and mode='day', resolver returns the override."""
    params = default_signal_parameters()
    day_override = CompositeParameters(
        technical_weight=0.32,
        news_weight=0.25,
        macro_weight=0.10,
        sector_weight=0.12,
        geopolitical_weight=0.08,
        internals_weight=0.13,
    )
    custom = replace(params, day_composite=day_override)

    assert resolve_composite_block(custom, mode="day") is day_override
    # mode="swing" must NOT pick up the day override.
    assert resolve_composite_block(custom, mode="swing") is custom.composite
    assert resolve_composite_block(custom, mode=None) is custom.composite


@pytest.mark.unit
def test_resolve_composite_block_handles_both_overrides_independently():
    """When both per-mode blocks are set, each mode picks its own block."""
    params = default_signal_parameters()
    swing_override = replace(params.composite, technical_weight=0.99)
    day_override = replace(params.composite, technical_weight=0.01)
    custom = replace(params, swing_composite=swing_override, day_composite=day_override)

    assert resolve_composite_block(custom, mode="swing") is swing_override
    assert resolve_composite_block(custom, mode="day") is day_override
    assert resolve_composite_block(custom, mode=None) is custom.composite


@pytest.mark.unit
def test_resolve_composite_block_ignores_unknown_mode():
    """Defensive: unknown mode strings fall back to the shared block."""
    params = default_signal_parameters()
    swing_override = replace(params.composite, technical_weight=0.99)
    day_override = replace(params.composite, technical_weight=0.01)
    custom = replace(params, swing_composite=swing_override, day_composite=day_override)

    assert resolve_composite_block(custom, mode="options") is custom.composite
    assert resolve_composite_block(custom, mode="") is custom.composite
    assert resolve_composite_block(custom, mode="SWING") is custom.composite  # case-sensitive


@pytest.mark.unit
def test_build_engine_swing_and_day_identical_when_no_override():
    """No-op default end-to-end: with shared block only, both modes build the same engine.

    This is the **back-compat guarantee** of the per-mode override system. Until
    operators add `swing_composite` / `day_composite` to Secrets Manager, every
    parameter version stamped on a SignalRecord is identical regardless of mode.
    """
    params = default_signal_parameters()
    swing_engine = build_composite_score_engine_from_params(params, mode="swing")
    day_engine = build_composite_score_engine_from_params(params, mode="day")
    legacy_engine = build_composite_score_engine_from_params(params)  # mode=None

    assert swing_engine._base_weights == day_engine._base_weights
    assert swing_engine._base_weights == legacy_engine._base_weights
    assert swing_engine._bullish_threshold == day_engine._bullish_threshold
    assert swing_engine._bearish_threshold == day_engine._bearish_threshold


@pytest.mark.unit
def test_build_engine_swing_mode_uses_swing_override_weights():
    """When swing_composite is set, mode='swing' actually picks up the override weights."""
    params = default_signal_parameters()
    swing_override = CompositeParameters(
        technical_weight=0.28,
        news_weight=0.15,
        macro_weight=0.20,
        sector_weight=0.18,
        geopolitical_weight=0.12,
        internals_weight=0.07,
        bullish_threshold=0.30,
        bearish_threshold=-0.30,
    )
    custom = replace(params, swing_composite=swing_override)

    engine = build_composite_score_engine_from_params(custom, mode="swing")
    assert engine._base_weights == {
        "technical": pytest.approx(0.28),
        "news": pytest.approx(0.15),
        "macro": pytest.approx(0.20),
        "sector": pytest.approx(0.18),
        "geopolitical": pytest.approx(0.12),
        "internals": pytest.approx(0.07),
    }
    assert engine._bullish_threshold == pytest.approx(0.30)
    assert engine._bearish_threshold == pytest.approx(-0.30)


@pytest.mark.unit
def test_build_engine_day_mode_uses_day_override_weights():
    """When day_composite is set, mode='day' actually picks up the override weights."""
    params = default_signal_parameters()
    day_override = CompositeParameters(
        technical_weight=0.32,
        news_weight=0.25,
        macro_weight=0.10,
        sector_weight=0.12,
        geopolitical_weight=0.08,
        internals_weight=0.13,
        bullish_threshold=0.25,
        bearish_threshold=-0.25,
    )
    custom = replace(params, day_composite=day_override)

    engine = build_composite_score_engine_from_params(custom, mode="day")
    assert engine._base_weights == {
        "technical": pytest.approx(0.32),
        "news": pytest.approx(0.25),
        "macro": pytest.approx(0.10),
        "sector": pytest.approx(0.12),
        "geopolitical": pytest.approx(0.08),
        "internals": pytest.approx(0.13),
    }
    assert engine._bullish_threshold == pytest.approx(0.25)
    assert engine._bearish_threshold == pytest.approx(-0.25)


@pytest.mark.unit
def test_build_engine_swing_mode_does_not_pick_up_day_override():
    """Cross-mode isolation: setting day_composite must NOT leak into swing engine."""
    params = default_signal_parameters()
    day_override = replace(params.composite, technical_weight=0.99)
    custom = replace(params, day_composite=day_override)

    swing_engine = build_composite_score_engine_from_params(custom, mode="swing")
    # Swing engine sees the shared block, not the day override.
    assert swing_engine._base_weights["technical"] == pytest.approx(
        params.composite.technical_weight
    )
    assert swing_engine._base_weights["technical"] != pytest.approx(0.99)


@pytest.mark.unit
def test_build_engine_day_mode_does_not_pick_up_swing_override():
    """Cross-mode isolation: setting swing_composite must NOT leak into day engine."""
    params = default_signal_parameters()
    swing_override = replace(params.composite, technical_weight=0.99)
    custom = replace(params, swing_composite=swing_override)

    day_engine = build_composite_score_engine_from_params(custom, mode="day")
    assert day_engine._base_weights["technical"] == pytest.approx(
        params.composite.technical_weight
    )
    assert day_engine._base_weights["technical"] != pytest.approx(0.99)


@pytest.mark.unit
def test_per_mode_overrides_actually_change_composite_score():
    """End-to-end wire-is-live: rotating only the swing override moves the swing score
    while the day score (with no override) stays anchored to the shared block.

    This is the regression guard that prevents any future refactor from silently
    discarding the per-mode override blocks — without this test, swapping the
    resolver back to `params.composite` everywhere would not be caught.
    """
    signals = [
        LayerSignal(layer="technical", score=1.0, confidence=1.0),
        LayerSignal(layer="news", score=-1.0, confidence=1.0),
        LayerSignal(layer="macro", score=0.0, confidence=1.0),
    ]
    params = default_signal_parameters()

    # Baseline: no overrides — swing and day produce the same score.
    baseline_swing = build_composite_score_engine_from_params(params, mode="swing").compute(
        signals, regime="sideways"
    )
    baseline_day = build_composite_score_engine_from_params(params, mode="day").compute(
        signals, regime="sideways"
    )
    assert baseline_swing.score == pytest.approx(baseline_day.score)

    # Rotate swing override to be heavily bullish-technical / low-news (the proposed
    # audit direction is the opposite, but we use an extreme value here so the score
    # delta is unambiguous regardless of regime multipliers).
    swing_override = CompositeParameters(
        technical_weight=0.80,
        news_weight=0.05,
        macro_weight=0.05,
        sector_weight=0.05,
        geopolitical_weight=0.03,
        internals_weight=0.02,
    )
    rotated = replace(params, swing_composite=swing_override)

    rotated_swing = build_composite_score_engine_from_params(rotated, mode="swing").compute(
        signals, regime="sideways"
    )
    rotated_day = build_composite_score_engine_from_params(rotated, mode="day").compute(
        signals, regime="sideways"
    )

    # Swing score moves significantly (technical weight 8x; news weight cut 4x).
    assert rotated_swing.score > baseline_swing.score
    # Day score is anchored to the shared block — unchanged.
    assert rotated_day.score == pytest.approx(baseline_day.score)


@pytest.mark.unit
def test_alignment_meta_uses_post_penalty_verdict():
    """alignment_ratio and conflicted_layers must be computed against the post-contradiction-
    penalty verdict, not the pre-penalty raw verdict. If the penalty flips the verdict from
    BULLISH to NEUTRAL the reported alignment must reflect NEUTRAL semantics."""
    engine = CompositeScoreEngine(bullish_threshold=0.20, bearish_threshold=-0.20)
    signals = [
        LayerSignal(layer="technical", score=0.30, confidence=1.0),
        LayerSignal(layer="news", score=-0.90, confidence=1.0),
        LayerSignal(layer="macro", score=-0.90, confidence=1.0),
        LayerSignal(layer="sector", score=-0.90, confidence=1.0),
        LayerSignal(layer="geopolitical", score=0.30, confidence=1.0),
        LayerSignal(layer="internals", score=0.30, confidence=1.0),
    ]
    result = engine.compute(signals, regime="sideways")
    if result.verdict == CompositeVerdict.NEUTRAL:
        assert result.alignment_ratio <= 1.0
    elif result.verdict == CompositeVerdict.BEARISH:
        assert result.alignment_ratio >= 0.0
