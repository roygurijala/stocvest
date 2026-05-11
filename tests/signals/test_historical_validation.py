"""
Tests for ``stocvest.signals.historical_validation``.

These lock in the contract that Phase 2+ (service layer, API, UI) will depend on:

- Directional accuracy is ``correct / (correct + incorrect)`` and excludes neutrals from
  the denominator, matching the existing public ``/performance`` summary.
- An empty stratum returns ``accuracy = NaN`` so the UI can render "—" rather than a
  misleading "0%".
- Rows with no outcome for the chosen horizon contribute zero to that horizon's stats but
  still count in ``rows_examined``.
- Stratification covers Decision state, Macro regime, trading Mode, Pattern, Trade
  Readiness bucket, and Direction. Unknown / missing values land under ``unknown`` or
  ``other`` and are visible in the output rather than silently dropped.
- ``parameter_versions`` is the sorted set of versions observed, so the validation page
  can show users exactly which rules-bundle the number describes.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from stocvest.data.models import SignalRecord
from stocvest.signals.historical_validation import (
    BucketStats,
    HistoricalValidationSummary,
    validate_signal_history,
)


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _signal(
    *,
    signal_id: str = "sig-1",
    symbol: str = "TEST",
    direction: str = "bullish",
    signal_strength: int = 75,
    pattern: str = "swing_composite",
    mode: str = "swing",
    decision_state_entry: str | None = "actionable",
    regime_label_at_entry: str | None = "risk_on",
    outcome_1h: str | None = None,
    outcome_1d: str | None = None,
    parameter_version: str | None = "v1",
) -> SignalRecord:
    """Build a minimally-valid ``SignalRecord`` for tests.

    The fixture only sets fields ``validate_signal_history`` reads; defaults match a
    typical actionable risk-on swing setup so individual tests can override one knob at a
    time without restating the whole row.
    """

    return SignalRecord(
        signal_id=signal_id,
        symbol=symbol,
        direction=direction,
        signal_strength=signal_strength,
        pattern=pattern,
        layer_scores={},
        price_at_signal=100.0,
        generated_at=datetime(2026, 5, 10, 14, 30, tzinfo=timezone.utc),
        outcome_1h=outcome_1h,
        outcome_1d=outcome_1d,
        mode=mode,
        decision_state_entry=decision_state_entry,
        regime_label_at_entry=regime_label_at_entry,
        parameter_version=parameter_version,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Empty / boundary cases
# ─────────────────────────────────────────────────────────────────────────────


def test_empty_input_returns_nan_accuracy_and_zero_totals() -> None:
    """No records → NaN accuracy (not 0%) so the UI can render "—"."""

    summary = validate_signal_history([], horizon="1h")
    assert isinstance(summary, HistoricalValidationSummary)
    assert summary.rows_examined == 0
    assert summary.overall.total_signals == 0
    assert summary.overall.correct == 0
    assert summary.overall.incorrect == 0
    assert summary.overall.neutral == 0
    assert math.isnan(summary.overall.accuracy)
    assert summary.parameter_versions == ()


def test_all_neutral_outcomes_still_return_nan_accuracy() -> None:
    """Neutral outcomes do not count towards directional accuracy, so 100% neutral → NaN."""

    rows = [
        _signal(signal_id=f"s{i}", outcome_1h="neutral", outcome_1d="neutral")
        for i in range(3)
    ]
    summary = validate_signal_history(rows, horizon="1h")
    assert summary.overall.total_signals == 3
    assert summary.overall.neutral == 3
    assert summary.overall.correct == 0
    assert summary.overall.incorrect == 0
    assert math.isnan(summary.overall.accuracy)


def test_rows_with_no_outcome_for_horizon_still_count_in_rows_examined() -> None:
    """A 1h-only resolved row is invisible to the 1d horizon, but is still examined."""

    rows = [_signal(outcome_1h="correct", outcome_1d=None)]
    summary_1h = validate_signal_history(rows, horizon="1h")
    summary_1d = validate_signal_history(rows, horizon="1d")

    assert summary_1h.rows_examined == 1
    assert summary_1h.overall.total_signals == 1
    assert summary_1h.overall.correct == 1

    assert summary_1d.rows_examined == 1
    assert summary_1d.overall.total_signals == 0
    assert math.isnan(summary_1d.overall.accuracy)


# ─────────────────────────────────────────────────────────────────────────────
# Overall accuracy math
# ─────────────────────────────────────────────────────────────────────────────


def test_overall_accuracy_excludes_neutrals_from_denominator() -> None:
    """Two correct + one incorrect + one neutral → 2/3, not 2/4."""

    rows = [
        _signal(signal_id="s1", outcome_1h="correct"),
        _signal(signal_id="s2", outcome_1h="correct"),
        _signal(signal_id="s3", outcome_1h="incorrect"),
        _signal(signal_id="s4", outcome_1h="neutral"),
    ]
    summary = validate_signal_history(rows, horizon="1h")
    assert summary.overall.total_signals == 4
    assert summary.overall.correct == 2
    assert summary.overall.incorrect == 1
    assert summary.overall.neutral == 1
    assert math.isclose(summary.overall.accuracy, 2 / 3)


def test_horizon_routing_uses_correct_outcome_column() -> None:
    """1h and 1d are independent columns and must not bleed into each other."""

    rows = [
        _signal(signal_id="s1", outcome_1h="correct", outcome_1d="incorrect"),
        _signal(signal_id="s2", outcome_1h="correct", outcome_1d="correct"),
    ]
    summary_1h = validate_signal_history(rows, horizon="1h")
    summary_1d = validate_signal_history(rows, horizon="1d")

    assert summary_1h.overall.correct == 2
    assert summary_1h.overall.incorrect == 0
    assert math.isclose(summary_1h.overall.accuracy, 1.0)

    assert summary_1d.overall.correct == 1
    assert summary_1d.overall.incorrect == 1
    assert math.isclose(summary_1d.overall.accuracy, 0.5)


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Decision state
# ─────────────────────────────────────────────────────────────────────────────


def test_stratifies_by_decision_state_and_buckets_legacy_rows_as_unknown() -> None:
    """Rows emitted before the validation-ledger columns shipped land under ``unknown``."""

    rows = [
        _signal(signal_id="a1", decision_state_entry="actionable", outcome_1h="correct"),
        _signal(signal_id="a2", decision_state_entry="actionable", outcome_1h="correct"),
        _signal(signal_id="m1", decision_state_entry="monitor", outcome_1h="incorrect"),
        _signal(signal_id="b1", decision_state_entry="blocked", outcome_1h="neutral"),
        _signal(signal_id="legacy", decision_state_entry=None, outcome_1h="correct"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert math.isclose(summary.by_decision["actionable"].accuracy, 1.0)
    assert summary.by_decision["actionable"].total_signals == 2

    assert math.isclose(summary.by_decision["monitor"].accuracy, 0.0)
    assert summary.by_decision["monitor"].incorrect == 1

    # Blocked row resolved neutral → NaN accuracy, not 0%.
    assert math.isnan(summary.by_decision["blocked"].accuracy)
    assert summary.by_decision["blocked"].neutral == 1

    assert summary.by_decision["unknown"].total_signals == 1
    assert math.isclose(summary.by_decision["unknown"].accuracy, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Regime
# ─────────────────────────────────────────────────────────────────────────────


def test_stratifies_by_macro_regime_using_engine_vocabulary() -> None:
    """Regime stratification uses ``risk_on`` / ``neutral`` / ``risk_off`` / ``avoid``.

    This matches what the engine actually writes into ``regime_label_at_entry`` (the UI
    separately maps to Bullish / Neutral / Bearish for display).
    """

    rows = [
        _signal(signal_id="r1", regime_label_at_entry="risk_on", outcome_1h="correct"),
        _signal(signal_id="r2", regime_label_at_entry="risk_on", outcome_1h="incorrect"),
        _signal(signal_id="n1", regime_label_at_entry="neutral", outcome_1h="correct"),
        _signal(signal_id="o1", regime_label_at_entry="risk_off", outcome_1h="incorrect"),
        _signal(signal_id="a1", regime_label_at_entry="avoid", outcome_1h="neutral"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert math.isclose(summary.by_regime["risk_on"].accuracy, 0.5)
    assert summary.by_regime["risk_on"].total_signals == 2

    assert math.isclose(summary.by_regime["neutral"].accuracy, 1.0)
    assert math.isclose(summary.by_regime["risk_off"].accuracy, 0.0)
    assert math.isnan(summary.by_regime["avoid"].accuracy)


def test_unknown_regime_falls_into_unknown_bucket_not_other() -> None:
    """Missing ``regime_label_at_entry`` is mapped to the declared ``unknown`` key."""

    rows = [_signal(regime_label_at_entry=None, outcome_1h="correct")]
    summary = validate_signal_history(rows, horizon="1h")

    assert summary.by_regime["unknown"].total_signals == 1
    assert "other" not in summary.by_regime


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Mode
# ─────────────────────────────────────────────────────────────────────────────


def test_stratifies_by_trading_mode() -> None:
    rows = [
        _signal(signal_id="s1", mode="swing", outcome_1h="correct"),
        _signal(signal_id="s2", mode="swing", outcome_1h="correct"),
        _signal(signal_id="s3", mode="swing", outcome_1h="incorrect"),
        _signal(signal_id="d1", mode="day", outcome_1h="correct"),
        _signal(signal_id="d2", mode="day", outcome_1h="incorrect"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert math.isclose(summary.by_mode["swing"].accuracy, 2 / 3)
    assert math.isclose(summary.by_mode["day"].accuracy, 0.5)


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Trade Readiness
# ─────────────────────────────────────────────────────────────────────────────


def test_readiness_buckets_use_evidence_card_thresholds() -> None:
    """``signal_strength`` 70+ → high, 40–69 → moderate, <40 → low."""

    rows = [
        _signal(signal_id="h1", signal_strength=85, outcome_1h="correct"),
        _signal(signal_id="h2", signal_strength=70, outcome_1h="correct"),
        _signal(signal_id="m1", signal_strength=69, outcome_1h="incorrect"),
        _signal(signal_id="m2", signal_strength=40, outcome_1h="correct"),
        _signal(signal_id="l1", signal_strength=39, outcome_1h="incorrect"),
        _signal(signal_id="l2", signal_strength=10, outcome_1h="incorrect"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert summary.by_readiness["high"].total_signals == 2
    assert math.isclose(summary.by_readiness["high"].accuracy, 1.0)

    assert summary.by_readiness["moderate"].total_signals == 2
    assert math.isclose(summary.by_readiness["moderate"].accuracy, 0.5)

    assert summary.by_readiness["low"].total_signals == 2
    assert math.isclose(summary.by_readiness["low"].accuracy, 0.0)


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Pattern (incl. ``other`` overflow)
# ─────────────────────────────────────────────────────────────────────────────


def test_stratifies_by_pattern_and_overflows_unknown_patterns_into_other() -> None:
    """Patterns the module did not declare must land under ``other``, not vanish."""

    rows = [
        _signal(signal_id="s1", pattern="swing_composite", outcome_1h="correct"),
        _signal(signal_id="o1", pattern="orb", outcome_1h="incorrect"),
        _signal(signal_id="exotic", pattern="brand_new_pattern_v2", outcome_1h="correct"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert summary.by_pattern["swing_composite"].total_signals == 1
    assert summary.by_pattern["orb"].total_signals == 1
    # The exotic pattern is not in the declared set, so it overflows into ``other``.
    assert "other" in summary.by_pattern
    assert summary.by_pattern["other"].total_signals == 1
    assert math.isclose(summary.by_pattern["other"].accuracy, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Stratification: Direction
# ─────────────────────────────────────────────────────────────────────────────


def test_stratifies_by_direction() -> None:
    rows = [
        _signal(signal_id="b1", direction="bullish", outcome_1h="correct"),
        _signal(signal_id="b2", direction="bullish", outcome_1h="incorrect"),
        _signal(signal_id="r1", direction="bearish", outcome_1h="correct"),
        _signal(signal_id="n1", direction="neutral", outcome_1h="neutral"),
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert math.isclose(summary.by_direction["bullish"].accuracy, 0.5)
    assert math.isclose(summary.by_direction["bearish"].accuracy, 1.0)
    assert math.isnan(summary.by_direction["neutral"].accuracy)


# ─────────────────────────────────────────────────────────────────────────────
# Provenance: parameter versions
# ─────────────────────────────────────────────────────────────────────────────


def test_parameter_versions_are_sorted_and_unique() -> None:
    rows = [
        _signal(signal_id=f"s{i}", parameter_version=v, outcome_1h="correct")
        for i, v in enumerate(["v3", "v1", "v3", "v2", None])
    ]
    summary = validate_signal_history(rows, horizon="1h")

    assert summary.parameter_versions == ("v1", "v2", "v3")
    assert summary.rows_examined == 5


# ─────────────────────────────────────────────────────────────────────────────
# Immutability
# ─────────────────────────────────────────────────────────────────────────────


def test_summary_and_bucket_stats_are_immutable_dataclasses() -> None:
    """Phase 2 (caching) and Phase 3 (API serialisation) rely on these being frozen."""

    summary = validate_signal_history([_signal(outcome_1h="correct")], horizon="1h")

    try:
        summary.overall = BucketStats(0, 0, 0, 0, 0.0)  # type: ignore[misc]
    except Exception:
        immutable = True
    else:
        immutable = False
    assert immutable, "HistoricalValidationSummary must be frozen"

    try:
        summary.overall.correct = 99  # type: ignore[misc]
    except Exception:
        immutable_bucket = True
    else:
        immutable_bucket = False
    assert immutable_bucket, "BucketStats must be frozen"
