"""Lock-in tests for D10 Phase 4 — post-rotation accuracy monitor (pure-function core).

The monitor's job is to compute a single signed percentage-point delta
between the current and previous parameter_version's directional accuracy
over a trailing window. The CloudWatch alarm then fires on the metric the
:mod:`stocvest.api.handlers.weight_rotation_monitor` publisher emits.

Everything decision-critical lives in the pure-function service module:

* :func:`accuracy_pct_from_bucket` — NaN propagation for empty windows,
  0–100 scale matches the public ``/performance`` surface.
* :func:`detect_degradation` — signed delta, NaN propagation, threshold
  is by absolute percentage points (always treats threshold as positive).
* :func:`evaluate_post_rotation_accuracy` end-to-end with status routing:
  ``ok`` / ``degraded`` / ``insufficient_sample`` / ``baseline_unavailable``.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.historical_validation_service import (
    HistoricalValidationService,
)
from stocvest.api.services.post_rotation_monitor import (
    DEFAULT_DEGRADATION_THRESHOLD_PP,
    DEFAULT_WINDOW_DAYS,
    MIN_RESOLVED_SAMPLE,
    MONITOR_STATUSES,
    accuracy_pct_from_bucket,
    detect_degradation,
    evaluate_post_rotation_accuracy,
)
from stocvest.data.models import SignalRecord
from stocvest.signals.historical_validation import validate_signal_history


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _row(
    *,
    signal_id: str,
    parameter_version: str,
    outcome_1d: str,
    generated_at: datetime,
    direction: str = "bullish",
) -> SignalRecord:
    """Resolved SignalRecord with outcome_1d set so it counts at horizon=1d."""
    return SignalRecord(
        signal_id=signal_id,
        symbol="TEST",
        direction=direction,
        signal_strength=70,
        pattern="swing_composite",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=generated_at,
        outcome_1h=None,
        outcome_1d=outcome_1d,
        resolved_1d=True,
        mode="swing",
        decision_state_entry="actionable",
        regime_label_at_entry="risk_on",
        parameter_version=parameter_version,
    )


class _StubStore:
    """Minimal ``SignalHistoryReader`` double for the post-rotation monitor."""

    def __init__(self, rows: list[SignalRecord] | None = None) -> None:
        self.rows = list(rows or [])

    def get_signal_history(
        self,
        *,
        user_id: str | None = None,
        symbol: str | None = None,
        days: int = 30,
        limit: int = 100,
        mode: str | None = None,
        ledger_qualified_only: bool = False,
    ) -> list[SignalRecord]:
        # The monitor never filters by user_id (it's a platform metric), so
        # we return everything in the trailing-`days` window.
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        return [row for row in self.rows if row.generated_at >= cutoff]


def _make_rows_for_version(
    *,
    version: str,
    correct: int,
    incorrect: int,
    neutral: int,
    base_time: datetime,
) -> list[SignalRecord]:
    """Synthesise ``correct + incorrect + neutral`` resolved rows for one version.

    All rows are within a 60-second window around ``base_time`` so the
    test windows above never accidentally drop one to the wrong side of
    the boundary.
    """
    out: list[SignalRecord] = []
    n = 0
    for label, count in (("correct", correct), ("incorrect", incorrect), ("neutral", neutral)):
        for i in range(count):
            n += 1
            out.append(
                _row(
                    signal_id=f"{version}-{label}-{i}",
                    parameter_version=version,
                    outcome_1d=label,
                    generated_at=base_time + timedelta(seconds=n),
                )
            )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# accuracy_pct_from_bucket
# ─────────────────────────────────────────────────────────────────────────────


def test_accuracy_pct_empty_bucket_returns_nan():
    summary = validate_signal_history([], horizon="1d")
    assert math.isnan(accuracy_pct_from_bucket(summary))


def test_accuracy_pct_all_neutral_returns_nan_not_zero():
    base = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    rows = _make_rows_for_version(version="v1", correct=0, incorrect=0, neutral=5, base_time=base)
    summary = validate_signal_history(rows, horizon="1d")
    assert math.isnan(accuracy_pct_from_bucket(summary))


def test_accuracy_pct_matches_correct_over_directional():
    base = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    rows = _make_rows_for_version(version="v1", correct=4, incorrect=1, neutral=2, base_time=base)
    summary = validate_signal_history(rows, horizon="1d")
    # 4 of 5 directional = 80%
    assert accuracy_pct_from_bucket(summary) == pytest.approx(80.0)


def test_accuracy_pct_uses_100_scale_not_zero_to_one():
    base = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    rows = _make_rows_for_version(version="v1", correct=1, incorrect=1, neutral=0, base_time=base)
    summary = validate_signal_history(rows, horizon="1d")
    # 50%, not 0.5 — assert the documented scale lock-in.
    assert accuracy_pct_from_bucket(summary) == pytest.approx(50.0)


# ─────────────────────────────────────────────────────────────────────────────
# detect_degradation
# ─────────────────────────────────────────────────────────────────────────────


def test_detect_degradation_flags_drop_at_threshold():
    is_deg, delta = detect_degradation(55.0, 60.0, threshold_pp=5.0)
    assert is_deg is True
    assert delta == pytest.approx(-5.0)


def test_detect_degradation_below_threshold_is_ok():
    is_deg, delta = detect_degradation(58.0, 60.0, threshold_pp=5.0)
    assert is_deg is False
    assert delta == pytest.approx(-2.0)


def test_detect_degradation_improvement_is_ok():
    is_deg, delta = detect_degradation(70.0, 60.0, threshold_pp=5.0)
    assert is_deg is False
    assert delta == pytest.approx(10.0)


def test_detect_degradation_negative_threshold_is_treated_as_absolute():
    # Defensive — a future caller that accidentally negates the
    # threshold should still get the right answer.
    is_deg, _delta = detect_degradation(40.0, 60.0, threshold_pp=-5.0)
    assert is_deg is True


def test_detect_degradation_nan_on_either_side_is_not_degraded():
    is_deg1, delta1 = detect_degradation(math.nan, 60.0)
    is_deg2, delta2 = detect_degradation(60.0, math.nan)
    assert is_deg1 is False
    assert math.isnan(delta1)
    assert is_deg2 is False
    assert math.isnan(delta2)


def test_default_threshold_pp_is_five():
    # Lock-in: the default value is what Terraform's alarm threshold
    # mirrors. A drift here would silently uncalibrate the alarm.
    assert DEFAULT_DEGRADATION_THRESHOLD_PP == 5.0


def test_default_window_days_is_fourteen():
    assert DEFAULT_WINDOW_DAYS == 14


def test_min_resolved_sample_is_thirty():
    assert MIN_RESOLVED_SAMPLE == 30


def test_monitor_statuses_are_closed_set():
    assert MONITOR_STATUSES == (
        "ok",
        "degraded",
        "insufficient_sample",
        "baseline_unavailable",
    )


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_post_rotation_accuracy — end-to-end
# ─────────────────────────────────────────────────────────────────────────────


def _service_with_rows(rows: list[SignalRecord]) -> HistoricalValidationService:
    return HistoricalValidationService(_StubStore(rows))


def test_evaluate_returns_baseline_unavailable_when_no_previous_version():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    current_rows = _make_rows_for_version(
        version="v1.0.5",
        correct=40,
        incorrect=10,
        neutral=5,
        base_time=now - timedelta(days=3),
    )
    service = _service_with_rows(current_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v1.0.5",
        previous_parameter_version=None,
        service=service,
        now=now,
    )

    assert result.status == "baseline_unavailable"
    assert result.baseline is None
    assert result.delta_pp is None
    assert result.current is not None
    assert result.current.parameter_version == "v1.0.5"


def test_evaluate_returns_insufficient_sample_when_current_below_floor():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    # Only 5 directional rows for current — well below MIN_RESOLVED_SAMPLE=30.
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=4,
        incorrect=1,
        neutral=0,
        base_time=now - timedelta(days=2),
    )
    # Plenty of baseline rows in the immediate-prior window.
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=30,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
    )

    assert result.status == "insufficient_sample"
    assert result.delta_pp is None
    assert "min=30" in result.message
    assert result.current is not None
    assert result.baseline is not None
    assert result.current.resolved_total_directional == 5
    assert result.baseline.resolved_total_directional == 40


def test_evaluate_returns_insufficient_sample_when_baseline_below_floor():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=40,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=2),
    )
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=3,
        incorrect=1,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
    )

    assert result.status == "insufficient_sample"
    assert result.delta_pp is None


def test_evaluate_returns_ok_when_delta_within_threshold():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    # 30 correct, 10 incorrect → 75% for current.
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=30,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=2),
    )
    # 32 correct, 8 incorrect → 80% for baseline. Drop of 5pp == threshold, so within tolerance.
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=32,
        incorrect=8,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
        threshold_pp=10.0,  # generous threshold → 5pp drop is OK
    )

    assert result.status == "ok"
    assert result.delta_pp == pytest.approx(-5.0)
    assert result.current is not None
    assert result.baseline is not None
    assert result.current.accuracy_pct == pytest.approx(75.0)
    assert result.baseline.accuracy_pct == pytest.approx(80.0)


def test_evaluate_returns_degraded_when_drop_exceeds_threshold():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    # 20 correct, 20 incorrect → 50% for current.
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=20,
        incorrect=20,
        neutral=0,
        base_time=now - timedelta(days=2),
    )
    # 32 correct, 8 incorrect → 80% for baseline. Drop of 30pp >> threshold.
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=32,
        incorrect=8,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
        threshold_pp=5.0,
    )

    assert result.status == "degraded"
    assert result.delta_pp == pytest.approx(-30.0)
    assert "Post-rotation accuracy delta" in result.message
    assert "+50.00%" not in result.message  # negative deltas should render with `-`
    assert "-30.00pp" in result.message


def test_evaluate_falls_back_to_wider_window_when_immediate_prior_window_empty():
    """Baseline rows that fall outside the immediate-prior window but within
    the wider 2*window_days window should still produce a meaningful baseline.
    """
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=40,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=3),
    )
    # Baseline rows are 25 days back — outside the [14d, 28d) immediate-prior
    # window but inside the wider [0, 28d) fallback. Place them between days
    # 14 and 28 so the wider window picks them up.
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=30,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
    )

    assert result.status in {"ok", "degraded"}
    # The point of this test is to prove we *got* a baseline, not what status.
    assert result.baseline is not None
    assert result.baseline.resolved_total_directional == 40


def test_evaluate_overall_accuracy_uses_one_d_horizon_by_default():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    # Mix outcome_1d and outcome_1h to prove the 1d horizon is picked.
    # All outcome_1h are "correct"; all outcome_1d are "incorrect".
    rows: list[SignalRecord] = []
    for i in range(35):
        rows.append(
            SignalRecord(
                signal_id=f"sig-{i}",
                symbol="TEST",
                direction="bullish",
                signal_strength=70,
                pattern="swing_composite",
                layer_scores={},
                price_at_signal=100.0,
                generated_at=now - timedelta(days=2, seconds=i),
                outcome_1h="correct",
                outcome_1d="incorrect",
                resolved_1h=True,
                resolved_1d=True,
                mode="swing",
                decision_state_entry="actionable",
                regime_label_at_entry="risk_on",
                parameter_version="v2.0.0",
            )
        )
    for i in range(35):
        rows.append(
            SignalRecord(
                signal_id=f"base-{i}",
                symbol="TEST",
                direction="bullish",
                signal_strength=70,
                pattern="swing_composite",
                layer_scores={},
                price_at_signal=100.0,
                generated_at=now - timedelta(days=20, seconds=i),
                outcome_1h="incorrect",
                outcome_1d="correct",
                resolved_1h=True,
                resolved_1d=True,
                mode="swing",
                decision_state_entry="actionable",
                regime_label_at_entry="risk_on",
                parameter_version="v1.0.9",
            )
        )
    service = _service_with_rows(rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
    )

    # On 1d: current = 0% (all incorrect), baseline = 100% (all correct).
    assert result.current is not None
    assert result.baseline is not None
    assert result.current.accuracy_pct == pytest.approx(0.0)
    assert result.baseline.accuracy_pct == pytest.approx(100.0)
    assert result.status == "degraded"


def test_evaluate_threshold_lock_in_at_exactly_five_pp():
    """Exact 5pp drop with default threshold IS degraded (≤, not strict <)."""
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=15,
        incorrect=15,
        neutral=0,
        base_time=now - timedelta(days=2),
    )  # 50%
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=44,
        incorrect=36,
        neutral=0,
        base_time=now - timedelta(days=20),
    )  # 55%
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
        threshold_pp=5.0,
    )

    assert result.status == "degraded"
    assert result.delta_pp == pytest.approx(-5.0)


def test_evaluate_window_accuracy_carries_iso_window_strings():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    current_rows = _make_rows_for_version(
        version="v2.0.0",
        correct=30,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=2),
    )
    baseline_rows = _make_rows_for_version(
        version="v1.0.9",
        correct=30,
        incorrect=10,
        neutral=0,
        base_time=now - timedelta(days=20),
    )
    service = _service_with_rows(current_rows + baseline_rows)

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version="v1.0.9",
        service=service,
        now=now,
    )

    assert result.current is not None
    assert result.baseline is not None
    # Lock-in: current window is the trailing-14-day window ending now.
    assert result.current.window_end == now.isoformat()
    # Lock-in: baseline window ends where current begins.
    assert result.baseline.window_end == (now - timedelta(days=14)).isoformat()
    assert result.baseline.window_start == (now - timedelta(days=28)).isoformat()


def test_evaluate_to_dict_carries_status_and_delta_payload():
    """Lock-in: to_dict() produces a JSON-serializable monitor payload."""
    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    service = _service_with_rows([])

    result = evaluate_post_rotation_accuracy(
        current_parameter_version="v2.0.0",
        previous_parameter_version=None,
        service=service,
        now=now,
    )

    payload = result.to_dict()
    assert payload["status"] == "baseline_unavailable"
    assert payload["delta_pp"] is None
    assert payload["threshold_pp"] == 5.0
    assert payload["baseline"] is None
    assert "current" in payload
