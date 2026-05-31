"""Tests for ``stocvest.signals.product_kpi`` — canonical product KPI cohort."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from stocvest.data.models import SignalRecord
from stocvest.signals.historical_validation import validate_signal_history
from stocvest.signals.product_kpi import (
    PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL,
    evaluate_version_promotion,
    filter_product_kpi_cohort,
    is_product_kpi_cohort_row,
    is_product_kpi_scored_row,
    performance_summary_from_product_kpi_records,
    public_validation_summary_dict,
    summarize_product_kpi,
    summarize_product_kpi_by_version,
    wilson_score_interval,
)


def _row(
    *,
    signal_id: str = "s1",
    capture_kind: str | None = "qualified",
    ledger_qualified: bool = True,
    decision_state_entry: str | None = "actionable",
    outcome_1d: str | None = "correct",
    signal_strength: int = 80,
    parameter_version: str = "v1",
    mode: str = "swing",
) -> SignalRecord:
    return SignalRecord(
        signal_id=signal_id,
        symbol="AAPL",
        direction="bullish",
        signal_strength=signal_strength,
        pattern="swing_composite",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        outcome_1d=outcome_1d,
        mode=mode,  # type: ignore[arg-type]
        ledger_qualified=ledger_qualified,
        decision_state_entry=decision_state_entry,
        capture_kind=capture_kind,  # type: ignore[arg-type]
        parameter_version=parameter_version,
    )


def test_cohort_predicate_requires_qualified_actionable() -> None:
    assert is_product_kpi_cohort_row(_row())
    assert not is_product_kpi_cohort_row(_row(capture_kind="shadow"))
    assert not is_product_kpi_cohort_row(_row(decision_state_entry="monitor"))
    assert not is_product_kpi_cohort_row(_row(ledger_qualified=False))


def test_scored_row_excludes_neutral_and_pending() -> None:
    assert is_product_kpi_scored_row(_row(outcome_1d="correct"), horizon="1d")
    assert not is_product_kpi_scored_row(_row(outcome_1d="neutral"), horizon="1d")
    assert not is_product_kpi_scored_row(_row(outcome_1d=None), horizon="1d")


def test_filter_product_kpi_cohort() -> None:
    rows = [
        _row(signal_id="a"),
        _row(signal_id="b", capture_kind="shadow"),
    ]
    assert len(filter_product_kpi_cohort(rows)) == 1


def test_summarize_accuracy_excludes_neutral() -> None:
    rows = [
        _row(signal_id="c1", outcome_1d="correct"),
        _row(signal_id="c2", outcome_1d="incorrect"),
        _row(signal_id="c3", outcome_1d="neutral"),
        _row(signal_id="c4", outcome_1d=None),
    ]
    from_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    summary = summarize_product_kpi(rows, horizon="1d", from_at=from_at, to_at=to_at)
    assert summary.coverage.cohort_rows == 4
    assert summary.coverage.resolved_non_neutral == 2
    assert math.isclose(summary.accuracy.stats.accuracy, 0.5)
    assert not summary.meets_minimum_sample


def test_minimum_sample_gate() -> None:
    rows = [
        _row(signal_id=f"s{i}", outcome_1d="correct" if i % 2 == 0 else "incorrect")
        for i in range(PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL)
    ]
    from_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    summary = summarize_product_kpi(rows, horizon="1d", from_at=from_at, to_at=to_at)
    assert summary.meets_minimum_sample


def test_promotion_requires_accuracy_and_volume() -> None:
    from_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_at = datetime(2026, 6, 1, tzinfo=timezone.utc)

    def _version_summary(version: str, correct: int, total: int) -> object:
        rows = [
            _row(
                signal_id=f"{version}-{i}",
                parameter_version=version,
                outcome_1d="correct" if i < correct else "incorrect",
            )
            for i in range(total)
        ]
        return summarize_product_kpi(rows, horizon="1d", from_at=from_at, to_at=to_at)

    prior = _version_summary("v1", correct=20, total=40)
    better = _version_summary("v2", correct=35, total=40)
    worse = _version_summary("v3", correct=10, total=40)

    assert evaluate_version_promotion(candidate=better, prior=prior).promoted  # type: ignore[arg-type]
    assert not evaluate_version_promotion(candidate=worse, prior=prior).promoted  # type: ignore[arg-type]


def test_trading_days_in_window_excludes_nyse_holidays() -> None:
    from stocvest.signals.product_kpi import _trading_days_in_window

    # Mon 2026-06-01 through Sat 2026-06-06 → 5 NYSE sessions (no holiday that week)
    from_at = datetime(2026, 6, 1, 14, 0, tzinfo=timezone.utc)
    to_at = datetime(2026, 6, 6, 14, 0, tzinfo=timezone.utc)
    assert _trading_days_in_window(from_at, to_at) == 5

    # Two-day window on a known holiday (2026-01-01, Thursday ET)
    from_at = datetime(2026, 1, 1, 5, 0, tzinfo=timezone.utc)
    to_at = datetime(2026, 1, 2, 5, 0, tzinfo=timezone.utc)
    assert _trading_days_in_window(from_at, to_at) == 1


def test_wilson_interval_bounds() -> None:
    interval = wilson_score_interval(7, 3)
    assert interval is not None
    lo, hi = interval
    assert 0.0 <= lo < hi <= 1.0
    assert lo < 0.7 < hi


def test_performance_summary_hides_accuracy_below_minimum() -> None:
    rows = [
        _row(signal_id=f"s{i}", outcome_1d="correct" if i % 2 else "incorrect")
        for i in range(10)
    ]
    body = performance_summary_from_product_kpi_records(rows)
    assert body["total_signals_tracked"] == 10
    assert body["resolved_non_neutral"] == 10
    assert body["meets_minimum_sample"] is False
    assert body["directional_accuracy_percent"] is None


def test_public_summary_by_mode_includes_wilson_when_n_ge_5() -> None:
    rows = [
        _row(signal_id=f"sw{i}", mode="swing", outcome_1d="correct")
        for i in range(5)
    ] + [
        _row(signal_id=f"dy{i}", mode="day", outcome_1d="incorrect")
        for i in range(3)
    ]
    from_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    kpi = summarize_product_kpi(rows, horizon="1d", from_at=from_at, to_at=to_at)
    stratified = validate_signal_history(filter_product_kpi_cohort(rows), horizon="1d")
    public = public_validation_summary_dict(stratified, kpi=kpi)
    swing = public["by_mode"]["swing"]
    day = public["by_mode"]["day"]
    assert swing["accuracy_ci_low_percent"] is not None
    assert swing["accuracy_ci_high_percent"] is not None
    assert day["accuracy_ci_low_percent"] is None
    assert day["accuracy_ci_high_percent"] is None


def test_by_version_includes_all_bucket() -> None:
    rows = [
        _row(signal_id="a", parameter_version="v1"),
        _row(signal_id="b", parameter_version="v2"),
    ]
    from_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    per = summarize_product_kpi_by_version(rows, horizon="1d", from_at=from_at, to_at=to_at)
    assert "__all__" in per
    assert "v1" in per
    assert "v2" in per
