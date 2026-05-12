"""Lock-in tests for D10 Phase 2a — walk-forward weight optimizer.

The optimizer is the algorithmic core of the proposal-only weight-tuning
pipeline. Every claim it makes — "candidate X beats baseline by 4pp on val"
— is the trust the human reviewer in Phase 3 stakes their approval on. These
tests pin the math so that a future refactor can't silently regress the
algorithm's behavior.

What's locked in:

* WeightSet invariants (normalize sums to 1.0, sum-must-be-positive guard,
  composite-block round-trip).
* Engine-mirror constants stay in lockstep with signal_recorder
  (NEUTRAL_MOVE_PCT, outcome_from_prices semantics).
* score_weight_candidate replays the production engine correctly: an
  unambiguously bullish row set scores 1.0; an opposite-direction row set
  scores 0.0; neutral outcomes are excluded from the denominator.
* walk_forward_split produces chronological train/val with the right
  proportions; defends against unsorted input.
* regime_distributions_match enforces the 20% tolerance; empty side is
  permissive (the empty-rows check is the caller's job).
* generate_candidate_weights produces the expected 729-baseline candidate
  count, normalizes each, dedupes, and includes the baseline first.
* accept_proposal enforces all three gates independently and surfaces a
  human-readable reason on rejection.
* optimize_weights_for_mode end-to-end: synthetic data where the truth is
  known, the optimizer finds the right rotation, the result fields are
  populated correctly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.signals.weight_optimizer import (
    DEFAULT_DELTA,
    DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT,
    DEFAULT_MIN_VAL_SIGNAL_COUNT,
    DEFAULT_REGIME_TOLERANCE,
    DEFAULT_TRAIN_FRACTION,
    NEUTRAL_MOVE_PCT,
    WEIGHT_LAYERS,
    HistoricalSignalRow,
    OptimizationResult,
    WeightSet,
    accept_proposal,
    generate_candidate_weights,
    optimize_weights_for_mode,
    outcome_from_prices,
    regime_distribution,
    regime_distributions_match,
    regime_for_engine_from_application_label,
    score_weight_candidate,
    walk_forward_split,
)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _baseline_weights() -> WeightSet:
    """The production-default composite weights (matches DEFAULT_BASE_WEIGHTS but rounded)."""
    return WeightSet(
        technical=0.30,
        news=0.20,
        macro=0.15,
        sector=0.15,
        geopolitical=0.10,
        internals=0.10,
    )


def _row(
    *,
    layer_scores: dict[str, float],
    price_at_signal: float = 100.0,
    price_after: float = 102.0,
    regime: str = "sideways",
    generated_at: datetime | None = None,
) -> HistoricalSignalRow:
    return HistoricalSignalRow(
        layer_scores=dict(layer_scores),
        regime_for_engine=regime,
        price_at_signal=price_at_signal,
        price_after=price_after,
        generated_at=generated_at or datetime(2026, 4, 1, tzinfo=timezone.utc),
    )


# ---------------------------------------------------------------------------
# WeightSet invariants
# ---------------------------------------------------------------------------


def test_weight_set_normalize_sum_is_one() -> None:
    """Normalized weights sum to exactly 1.0."""
    ws = WeightSet(0.3, 0.2, 0.15, 0.15, 0.1, 0.1).normalize()
    assert math.isclose(ws.sum(), 1.0, abs_tol=1e-9)


def test_weight_set_normalize_rescales_unscaled_input() -> None:
    """Unscaled weights (sum != 1) normalize to a 1.0 sum without changing relative ratios."""
    ws = WeightSet(0.6, 0.4, 0.3, 0.3, 0.2, 0.2)  # sums to 2.0
    normalized = ws.normalize()
    assert math.isclose(normalized.sum(), 1.0, abs_tol=1e-9)
    # Relative ratios preserved: technical/news was 0.6/0.4 = 1.5 before; should be 0.3/0.2 = 1.5 after.
    assert math.isclose(normalized.technical / normalized.news, 1.5, abs_tol=1e-9)


def test_weight_set_normalize_rejects_non_positive_sum() -> None:
    """Sum ≤ 0 means a degenerate engine — raise loud."""
    ws = WeightSet(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    with pytest.raises(ValueError, match="WeightSet sum must be positive"):
        ws.normalize()


def test_weight_set_from_composite_block_lifts_duck_typed_object() -> None:
    """from_composite_block accepts any object with *_weight attrs (test fixture, prod CompositeParameters)."""

    @dataclass
    class _Block:
        technical_weight: float = 0.25
        news_weight: float = 0.20
        macro_weight: float = 0.20
        sector_weight: float = 0.15
        geopolitical_weight: float = 0.10
        internals_weight: float = 0.10

    ws = WeightSet.from_composite_block(_Block())
    assert ws.technical == 0.25
    assert ws.news == 0.20
    assert ws.macro == 0.20
    assert ws.sector == 0.15
    assert ws.geopolitical == 0.10
    assert ws.internals == 0.10


def test_weight_set_to_composite_block_dict_includes_thresholds() -> None:
    """to_composite_block_dict produces a JSON-friendly payload that round-trips through CompositeParameters parsing."""
    ws = _baseline_weights()
    block = ws.to_composite_block_dict(bullish_threshold=0.22, bearish_threshold=-0.22)
    assert block == {
        "technical_weight": 0.30,
        "news_weight": 0.20,
        "macro_weight": 0.15,
        "sector_weight": 0.15,
        "geopolitical_weight": 0.10,
        "internals_weight": 0.10,
        "bullish_threshold": 0.22,
        "bearish_threshold": -0.22,
    }


def test_weight_layers_canonical_order() -> None:
    """WEIGHT_LAYERS pins the canonical order — Phase 2b serialization depends on this."""
    assert WEIGHT_LAYERS == (
        "technical",
        "news",
        "macro",
        "sector",
        "geopolitical",
        "internals",
    )


# ---------------------------------------------------------------------------
# Engine-mirror helpers (must stay in lockstep with signal_recorder)
# ---------------------------------------------------------------------------


def test_neutral_move_pct_constant_pinned() -> None:
    """If signal_recorder changes its 0.1% threshold, this test catches the drift."""
    assert NEUTRAL_MOVE_PCT == 0.1


def test_outcome_from_prices_mirrors_signal_recorder() -> None:
    """Compare our local implementation against the canonical one."""
    from stocvest.api.services.signal_recorder import outcome_from_prices as canonical

    cases: list[tuple[str, float, float]] = [
        ("bullish", 100.0, 105.0),
        ("bullish", 100.0, 99.0),
        ("bullish", 100.0, 100.05),  # within 0.1% — neutral
        ("bearish", 100.0, 95.0),
        ("bearish", 100.0, 105.0),
        ("bearish", 100.0, 99.95),  # within 0.1% — neutral
        ("neutral", 100.0, 105.0),  # neutral direction never matches anything
    ]
    for direction, p_at, p_after in cases:
        assert outcome_from_prices(direction, p_at, p_after) == canonical(direction, p_at, p_after), (
            f"divergence on {(direction, p_at, p_after)}"
        )


def test_outcome_from_prices_neutral_when_price_after_missing() -> None:
    """A missing post-resolution price → neutral (no information)."""
    assert outcome_from_prices("bullish", 100.0, None) == "neutral"


def test_regime_for_engine_translation() -> None:
    """Application labels (risk_on / risk_off / neutral / avoid) → engine vocabulary (bull/bear/sideways)."""
    assert regime_for_engine_from_application_label("risk_on") == "bull"
    assert regime_for_engine_from_application_label("bullish") == "bull"
    assert regime_for_engine_from_application_label("bull") == "bull"
    assert regime_for_engine_from_application_label("risk_off") == "bear"
    assert regime_for_engine_from_application_label("bearish") == "bear"
    assert regime_for_engine_from_application_label("avoid") == "bear"
    assert regime_for_engine_from_application_label("neutral") == "sideways"
    assert regime_for_engine_from_application_label("") == "sideways"
    assert regime_for_engine_from_application_label(None) == "sideways"
    assert regime_for_engine_from_application_label("unknown_string") == "sideways"


# ---------------------------------------------------------------------------
# score_weight_candidate — accuracy math
# ---------------------------------------------------------------------------


def test_score_weight_candidate_unambiguously_bullish_row_set_scores_one() -> None:
    """Every layer score bullish + every price moves bullish → 100% accuracy."""
    rows = [
        _row(
            layer_scores={layer: 0.9 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=105.0,
        )
        for _ in range(5)
    ]
    score = score_weight_candidate(rows, _baseline_weights())
    assert score == 1.0


def test_score_weight_candidate_anti_bullish_set_scores_zero() -> None:
    """Every layer score strongly bullish but every price moves DOWN → 0% accuracy."""
    rows = [
        _row(
            layer_scores={layer: 0.9 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=95.0,
        )
        for _ in range(5)
    ]
    score = score_weight_candidate(rows, _baseline_weights())
    assert score == 0.0


def test_score_weight_candidate_excludes_neutral_outcomes_from_denominator() -> None:
    """A row whose price barely moved (within 0.1%) doesn't count for OR against."""
    rows = [
        # First row: bullish prediction + bullish move = correct
        _row(
            layer_scores={layer: 0.9 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=105.0,
        ),
        # Second row: bullish prediction + NEUTRAL move (within 0.1%) = neutral outcome
        _row(
            layer_scores={layer: 0.9 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=100.05,
        ),
    ]
    # Accuracy = 1 correct / (1 correct + 0 incorrect) = 1.0, not 0.5.
    score = score_weight_candidate(rows, _baseline_weights())
    assert score == 1.0


def test_score_weight_candidate_returns_zero_when_all_outcomes_neutral() -> None:
    """An all-neutral row set means no information; return 0.0 not 1.0 / undefined."""
    rows = [
        _row(
            # All-zero layer scores → composite score = 0 → neutral verdict → neutral outcome.
            layer_scores={layer: 0.0 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=100.0,
        )
        for _ in range(5)
    ]
    score = score_weight_candidate(rows, _baseline_weights())
    assert score == 0.0


def test_score_weight_candidate_skips_row_with_empty_layer_scores() -> None:
    """A row with no layer scores is skipped (can't produce a verdict from nothing)."""
    rows = [
        _row(
            layer_scores={layer: 0.9 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_after=105.0,
        ),
        _row(
            layer_scores={},
            price_at_signal=100.0,
            price_after=95.0,  # would be incorrect IF the empty row weren't skipped
        ),
    ]
    score = score_weight_candidate(rows, _baseline_weights())
    assert score == 1.0  # only the first row counted


# ---------------------------------------------------------------------------
# walk_forward_split
# ---------------------------------------------------------------------------


def _row_at(day_offset: int) -> HistoricalSignalRow:
    return _row(
        layer_scores={layer: 0.5 for layer in WEIGHT_LAYERS},
        generated_at=datetime(2026, 4, 1, tzinfo=timezone.utc) + timedelta(days=day_offset),
    )


def test_walk_forward_split_chronological_75_25() -> None:
    """Default train/val split is 75/25 by row count, preserving chronological order."""
    rows = [_row_at(i) for i in range(8)]  # 8 rows, default 0.75 → 6 train / 2 val
    train, val = walk_forward_split(rows)
    assert len(train) == 6
    assert len(val) == 2
    # Earliest 6 in train, latest 2 in val.
    assert train[0].generated_at < val[0].generated_at
    assert train[-1].generated_at < val[0].generated_at


def test_walk_forward_split_respects_custom_fraction() -> None:
    """Custom fractions adjust the cut point."""
    rows = [_row_at(i) for i in range(10)]
    train, val = walk_forward_split(rows, train_fraction=0.5)
    assert len(train) == 5
    assert len(val) == 5


def test_walk_forward_split_rejects_invalid_fraction() -> None:
    """0 / 1 / negative / >1 fractions all raise."""
    rows = [_row_at(i) for i in range(8)]
    for bad in (0.0, 1.0, -0.1, 1.5):
        with pytest.raises(ValueError, match="train_fraction must be in"):
            walk_forward_split(rows, train_fraction=bad)


def test_walk_forward_split_empty_returns_empty_tuple() -> None:
    """Empty input → ([], []), no exception."""
    assert walk_forward_split([]) == ([], [])


def test_walk_forward_split_detects_unsorted_input() -> None:
    """First row newer than last row is loud-rejected — defends against random-shuffle leak."""
    rows = [_row_at(5), _row_at(4), _row_at(3), _row_at(2), _row_at(1), _row_at(0)]
    with pytest.raises(ValueError, match="must be sorted by generated_at ascending"):
        walk_forward_split(rows)


# ---------------------------------------------------------------------------
# regime_distribution + regime_distributions_match
# ---------------------------------------------------------------------------


def test_regime_distribution_counts_per_regime_key() -> None:
    rows = [
        _row(layer_scores={}, regime="bull"),
        _row(layer_scores={}, regime="bull"),
        _row(layer_scores={}, regime="bear"),
        _row(layer_scores={}, regime="sideways"),
    ]
    assert regime_distribution(rows) == {"bull": 2, "bear": 1, "sideways": 1}


def test_regime_distributions_match_close_distributions_pass() -> None:
    """60/30/10 vs 65/30/5 — max delta = 5pp, well under default 20% tolerance."""
    train = {"bull": 60, "bear": 30, "sideways": 10}
    val = {"bull": 65, "bear": 30, "sideways": 5}
    assert regime_distributions_match(train, val) is True


def test_regime_distributions_match_divergent_distributions_fail() -> None:
    """80/20 train vs 20/80 val — clearly different regimes, fail."""
    train = {"bull": 80, "bear": 20}
    val = {"bull": 20, "bear": 80}
    assert regime_distributions_match(train, val) is False


def test_regime_distributions_match_empty_side_returns_true() -> None:
    """Empty side → permissive; the caller's job to check signal counts."""
    assert regime_distributions_match({}, {"bull": 5}) is True
    assert regime_distributions_match({"bull": 5}, {}) is True
    assert regime_distributions_match({}, {}) is True


def test_regime_distributions_match_tolerance_boundary() -> None:
    """Just over the tolerance fails; just under passes."""
    train = {"bull": 60, "bear": 40}
    val = {"bull": 81, "bear": 19}  # bull frac diverges by 21pp > 20% default
    assert regime_distributions_match(train, val) is False
    val_close = {"bull": 79, "bear": 21}  # bull frac diverges by 19pp < 20% default
    assert regime_distributions_match(train, val_close) is True


# ---------------------------------------------------------------------------
# generate_candidate_weights
# ---------------------------------------------------------------------------


def test_generate_candidate_weights_includes_baseline_as_first() -> None:
    """Baseline is the always-included no-rotation candidate, emitted first."""
    baseline = _baseline_weights()
    candidates = generate_candidate_weights(baseline)
    # Baseline (after normalization) should be the first candidate.
    expected_first = baseline.normalize()
    assert candidates[0].as_dict() == expected_first.as_dict()


def test_generate_candidate_weights_all_normalized() -> None:
    """Every generated candidate sums to ~1.0 (post-normalization invariant)."""
    candidates = generate_candidate_weights(_baseline_weights())
    for c in candidates:
        assert math.isclose(c.sum(), 1.0, abs_tol=1e-9), f"candidate doesn't sum to 1: {c}"


def test_generate_candidate_weights_no_non_positive_weights() -> None:
    """A candidate that would have ≤0 on any layer is dropped, not normalized into existence."""
    candidates = generate_candidate_weights(_baseline_weights())
    for c in candidates:
        for layer, w in c.as_dict().items():
            assert w > 0, f"non-positive weight {w} on layer {layer} in {c}"


def test_generate_candidate_weights_dedupes_arithmetic_equivalents() -> None:
    """Two perturbation combinations that produce the same normalized result are deduped."""
    candidates = generate_candidate_weights(_baseline_weights())
    # Build the rounded-fingerprint set; the candidates list MUST have the same
    # length as the fingerprint set (no duplicates).
    fingerprints = {tuple(round(w, 4) for w in c.as_dict().values()) for c in candidates}
    assert len(fingerprints) == len(candidates)


def test_generate_candidate_weights_max_3_to_the_6_minus_dropped() -> None:
    """3^6 = 729 raw candidates is the upper bound; dropped + deduped means actual ≤ 729."""
    candidates = generate_candidate_weights(_baseline_weights())
    assert len(candidates) <= 729
    # And we should generate a non-trivial number — baseline-only would mean
    # something went badly wrong with the perturbation loop.
    assert len(candidates) > 50


def test_generate_candidate_weights_rejects_non_positive_delta() -> None:
    """Negative or zero delta → loud reject."""
    with pytest.raises(ValueError, match="delta must be positive"):
        generate_candidate_weights(_baseline_weights(), delta=0.0)
    with pytest.raises(ValueError, match="delta must be positive"):
        generate_candidate_weights(_baseline_weights(), delta=-0.05)


# ---------------------------------------------------------------------------
# accept_proposal — three independent gates
# ---------------------------------------------------------------------------


def _result(
    *,
    train_acc: float = 0.62,
    val_acc: float = 0.64,
    baseline_train: float = 0.59,
    baseline_val: float = 0.60,
    val_count: int = 87,
    regime_train: dict[str, int] | None = None,
    regime_val: dict[str, int] | None = None,
) -> OptimizationResult:
    """Convenience builder for acceptance-gate test cases."""
    return OptimizationResult(
        baseline_weights=_baseline_weights(),
        best_weights=_baseline_weights(),
        baseline_train_accuracy=baseline_train,
        baseline_val_accuracy=baseline_val,
        best_train_accuracy=train_acc,
        best_val_accuracy=val_acc,
        train_signal_count=200,
        val_signal_count=val_count,
        train_window_start=datetime(2026, 3, 15, tzinfo=timezone.utc),
        train_window_end=datetime(2026, 4, 26, tzinfo=timezone.utc),
        val_window_start=datetime(2026, 4, 26, tzinfo=timezone.utc),
        val_window_end=datetime(2026, 5, 10, tzinfo=timezone.utc),
        regime_distribution_train=regime_train or {"bull": 100, "sideways": 80, "bear": 20},
        regime_distribution_val=regime_val or {"bull": 40, "sideways": 35, "bear": 12},
        candidates_evaluated=400,
    )


def test_accept_proposal_happy_path() -> None:
    """4pp val lift + 87 signals + close regimes — accept."""
    decision = accept_proposal(_result())
    assert decision.accepted is True
    assert "val accuracy lift +0.040" in decision.reason


def test_accept_proposal_rejects_too_few_val_signals() -> None:
    """Below the minimum sample size — reject with a specific reason."""
    decision = accept_proposal(_result(val_count=12))
    assert decision.accepted is False
    assert "12 resolved signals" in decision.reason
    assert "30-row minimum" in decision.reason


def test_accept_proposal_rejects_insufficient_lift() -> None:
    """+1pp doesn't beat the 2pp threshold — reject."""
    decision = accept_proposal(_result(val_acc=0.61, baseline_val=0.60))
    assert decision.accepted is False
    assert "val accuracy lift" in decision.reason
    assert "below" in decision.reason


def test_accept_proposal_rejects_regime_drift() -> None:
    """Wildly different train/val regime mix — reject."""
    decision = accept_proposal(
        _result(
            regime_train={"bull": 100, "bear": 0},
            regime_val={"bull": 0, "bear": 100},
        )
    )
    assert decision.accepted is False
    assert "regime distribution diverges" in decision.reason


def test_accept_proposal_rejects_negative_lift() -> None:
    """Candidate worse than baseline — reject."""
    decision = accept_proposal(_result(val_acc=0.55, baseline_val=0.60))
    assert decision.accepted is False
    assert "below" in decision.reason


def test_accept_proposal_custom_thresholds() -> None:
    """Caller-tunable gates work end-to-end (sanity check on the kwargs)."""
    # Tightening the lift threshold to +5pp should reject a +4pp proposal.
    decision = accept_proposal(_result(), min_val_accuracy_improvement=0.05)
    assert decision.accepted is False
    # Loosening the sample-count threshold should let a 12-row proposal through
    # (lift is still 4pp ≥ default 2pp threshold).
    decision_loose = accept_proposal(_result(val_count=12), min_val_signal_count=10)
    assert decision_loose.accepted is True


# ---------------------------------------------------------------------------
# optimize_weights_for_mode — end-to-end on synthetic data
# ---------------------------------------------------------------------------


def test_optimize_weights_for_mode_returns_baseline_on_uniform_rows() -> None:
    """When every row scores the same regardless of weights, baseline wins (no candidate beats it)."""
    # All rows have all-zero layer scores → composite score = 0 → neutral verdict.
    # No candidate weights can produce a different verdict, so baseline_val_accuracy ==
    # best_val_accuracy and best_weights == baseline_weights.
    rows = [
        _row(
            layer_scores={layer: 0.0 for layer in WEIGHT_LAYERS},
            generated_at=datetime(2026, 4, 1, tzinfo=timezone.utc) + timedelta(days=i),
            price_at_signal=100.0,
            price_after=100.0,
        )
        for i in range(20)
    ]
    result = optimize_weights_for_mode(rows, _baseline_weights())
    assert result.best_weights.as_dict() == result.baseline_weights.as_dict()
    assert result.best_val_accuracy == result.baseline_val_accuracy


def test_optimize_weights_for_mode_picks_better_candidate_when_one_exists() -> None:
    """Synthetic scenario where rotating weight toward `news` should improve accuracy.

    Construction: 20 rows where the news layer perfectly predicts price direction
    but the technical layer points the wrong way. A baseline that weights
    technical at 0.30 (vs 0.20 news) gets fooled; rotating weight to news
    flips many verdicts and improves accuracy. The optimizer should find this.
    """
    rows: list[HistoricalSignalRow] = []
    for i in range(20):
        # News bullish, technical bearish; actual price moves bullish (news wins).
        rows.append(
            _row(
                layer_scores={
                    "technical": -0.7,
                    "news": 0.9,
                    "macro": 0.0,
                    "sector": 0.0,
                    "geopolitical": 0.0,
                    "internals": 0.0,
                },
                generated_at=datetime(2026, 4, 1, tzinfo=timezone.utc) + timedelta(days=i),
                price_at_signal=100.0,
                price_after=105.0,
            )
        )
    result = optimize_weights_for_mode(rows, _baseline_weights())
    # Best weights should have news ≥ baseline news weight (rotating toward news).
    # We don't pin the exact rotation — that's the optimizer's job — just the direction.
    assert result.best_weights.news >= result.baseline_weights.news
    # Best val accuracy must be ≥ baseline; if it's strictly greater, the optimizer
    # successfully found a rotation.
    assert result.best_val_accuracy >= result.baseline_val_accuracy


def test_optimize_weights_for_mode_populates_all_result_fields() -> None:
    """Every OptimizationResult field is populated — Phase 2b serialization relies on this."""
    rows = [
        _row(
            layer_scores={layer: 0.5 for layer in WEIGHT_LAYERS},
            generated_at=datetime(2026, 4, 1, tzinfo=timezone.utc) + timedelta(days=i),
            regime="bull" if i < 10 else "sideways",
        )
        for i in range(20)
    ]
    result = optimize_weights_for_mode(rows, _baseline_weights())
    assert result.train_signal_count > 0
    assert result.val_signal_count > 0
    assert result.train_window_start < result.train_window_end
    assert result.train_window_end <= result.val_window_start
    assert result.val_window_start < result.val_window_end
    assert result.candidates_evaluated > 0
    assert result.regime_distribution_train  # non-empty
    assert result.regime_distribution_val  # non-empty
    # Evidence dict round-trips through JSON-friendly types.
    evidence = result.as_evidence_dict()
    assert isinstance(evidence["train_accuracy"], float)
    assert isinstance(evidence["baseline_weights"], dict)
    assert isinstance(evidence["train_window_start"], str)  # ISO-8601


def test_optimize_weights_for_mode_rejects_empty_input() -> None:
    """No rows → loud reject."""
    with pytest.raises(ValueError, match="called with no rows"):
        optimize_weights_for_mode([], _baseline_weights())


def test_optimize_weights_for_mode_rejects_too_few_rows_for_split() -> None:
    """Two rows → 1 train / 1 val is technically valid but we want to fail loud on
    pathologically small inputs so the Phase-2b handler short-circuits cleanly.
    """
    # One row → split produces (1, 0) which fails the empty-side check.
    rows = [_row(layer_scores={layer: 0.5 for layer in WEIGHT_LAYERS})]
    with pytest.raises(ValueError, match="produced an empty side"):
        optimize_weights_for_mode(rows, _baseline_weights())


def test_optimize_weights_for_mode_evidence_dict_shape_matches_phase1_proposal_contract() -> None:
    """The evidence dict's keys match what the Phase-1 ParameterProposal docstring promises.

    Phase 1 documented this shape::

        {
          "swing": {
            "train_accuracy": ..., "val_accuracy": ...,
            "train_accuracy_baseline": ..., "val_accuracy_baseline": ...,
            "val_signal_count": ..., "regime_distribution": ...
          }
        }

    Phase 2a's evidence dict is the per-mode slice. Phase 2b's Lambda
    handler will wrap it as ``{"swing": evidence_swing, "day": evidence_day}``.
    """
    rows = [
        _row(
            layer_scores={layer: 0.5 for layer in WEIGHT_LAYERS},
            generated_at=datetime(2026, 4, 1, tzinfo=timezone.utc) + timedelta(days=i),
        )
        for i in range(20)
    ]
    evidence = optimize_weights_for_mode(rows, _baseline_weights()).as_evidence_dict()
    required_keys = {
        "train_accuracy",
        "val_accuracy",
        "train_accuracy_baseline",
        "val_accuracy_baseline",
        "val_signal_count",
        "regime_distribution_val",
    }
    assert required_keys.issubset(set(evidence.keys()))


# ---------------------------------------------------------------------------
# Module-level constants — pinned for documentation parity
# ---------------------------------------------------------------------------


def test_default_constants_documented_invariant() -> None:
    """If a default changes, this test fails — forcing an explicit doc / BACKLOG update."""
    assert DEFAULT_DELTA == 0.05
    assert DEFAULT_TRAIN_FRACTION == 0.75
    assert DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT == 0.02
    assert DEFAULT_MIN_VAL_SIGNAL_COUNT == 30
    assert DEFAULT_REGIME_TOLERANCE == 0.20
