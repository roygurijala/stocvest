"""D10 Phase 4 — post-rotation accuracy monitor (pure-function core).

This module is the *math* behind the CloudWatch alarm that fires when a
freshly-rotated set of signal weights produces measurably worse
directional accuracy than the version it replaced. The Lambda handler in
:mod:`stocvest.api.handlers.weight_rotation_monitor` is the thin wrapper
that wires this into the live ``SignalHistory`` store + CloudWatch.

Why a pure-function core
------------------------
The acceptance gate for the alarm is small but decision-critical: it has
to be impossible to silently shift from "5pp degradation triggers a page"
to "10pp" because someone refactored the publisher Lambda. By keeping
the threshold math, the sample-size guard, and the version-pair
selection in a pure function, the lock-in tests in
``tests/api/services/test_post_rotation_monitor.py`` pin the contract
end-to-end without any AWS surface in the way.

What the math says
------------------
- "Post-rotation accuracy" is the directional accuracy of every
  ``SignalRecord`` whose ``parameter_version`` equals the **current**
  live version, resolved over the last *N* days (default 14). The 1d
  outcome horizon matches D2's existing accuracy disclosure surface, so
  this metric and ``/performance`` cannot drift.
- "Pre-rotation baseline" is the directional accuracy of the
  **previous** ``parameter_version`` over the trailing 14-day window
  *before* the rotation. If the rotation happened recently we may not
  have 14 full days of pre-rotation data on disk for the previous
  version — in that case we fall back to the *most recent 14 days for
  which any rows tagged with the previous version exist*, and if there
  are still too few rows the monitor returns ``baseline_unavailable``
  rather than firing a noisy alarm on a tiny sample.
- "Degradation" is ``baseline_pct - current_pct`` in percentage points.
  We surface it both as a raw delta and as a boolean threshold breach.
- "Sample size guard" — both sides need at least
  :data:`MIN_RESOLVED_SAMPLE` directional outcomes (non-neutral) before
  the delta is considered actionable. Below that floor we publish a
  ``status = "insufficient_sample"`` instead of a numeric breach so the
  CloudWatch alarm only triggers on real signal.

The Lambda publishes the raw delta as a CloudWatch custom metric every
day. The alarm condition lives in Terraform, not Python — that's
deliberate: the *measurement* lives here (pinned by tests); the *policy*
(threshold, dimensions, notification channel) lives in
``infra/lambda_weight_rotation_monitor.tf`` where ops can tune it
without a code deploy.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from stocvest.api.services.historical_validation_service import (
    HistoricalValidationService,
    SignalHistoryReader,
)
from stocvest.signals.historical_validation import HistoricalValidationSummary
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


# ── Tunable defaults (locked in by tests) ────────────────────────────────

#: Rolling window for the post-rotation directional accuracy computation.
#: Two-week window matches the natural CloudWatch alarm cadence (small
#: enough to react inside a single review cycle, large enough to absorb
#: day-to-day noise on ~150–300 resolved-per-mode signal volumes).
DEFAULT_WINDOW_DAYS: int = 14

#: Directional-accuracy horizon — ``"1d"`` matches the public
#: ``/performance`` surface and ``GET /v1/signals/performance/summary``,
#: so this monitor's numbers cannot disagree with the user-visible page.
DEFAULT_HORIZON: Literal["1h", "1d"] = "1d"

#: Minimum resolved-non-neutral signal count on either side before a
#: delta is considered actionable. Below this floor the monitor surfaces
#: ``status="insufficient_sample"`` rather than a numeric breach, so a
#: brand-new rotation cannot trigger the alarm in its first hour purely
#: from sample noise.
MIN_RESOLVED_SAMPLE: int = 30

#: Default percentage-point threshold for the degradation alarm. A
#: drop of ≥5pp from the prior-version baseline is the operationally
#: agreed "this rotation might be a problem" line; below that the alarm
#: stays quiet. Terraform owns the actual alarm threshold via a CW
#: variable — this constant is used by :func:`detect_degradation` so
#: the Python side can label its return value consistently for tests
#: and admin observability.
DEFAULT_DEGRADATION_THRESHOLD_PP: float = 5.0


# ── Status closed-set ────────────────────────────────────────────────────

#: ``ok`` — both sides have ≥ MIN_RESOLVED_SAMPLE, delta ≥ -threshold.
#: ``degraded`` — both sides have enough sample, delta ≤ -threshold.
#: ``insufficient_sample`` — current and/or baseline window has too few
#: resolved-non-neutral rows; the alarm does NOT fire on this status.
#: ``baseline_unavailable`` — no prior version found in history (e.g.
#: this is the first rotation ever) so degradation is undefined; the
#: alarm does NOT fire.
MONITOR_STATUSES: tuple[str, ...] = (
    "ok",
    "degraded",
    "insufficient_sample",
    "baseline_unavailable",
)


# ── Dataclasses ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class WindowAccuracy:
    """Pure projection of a :class:`HistoricalValidationSummary` for one window.

    We deliberately do NOT carry the full stratified summary across
    process boundaries — the monitor only needs the overall directional
    accuracy + the denominator + the version label. Trimming here keeps
    the CloudWatch metric / SNS payload tiny and audit-traceable.
    """

    parameter_version: str
    resolved_correct: int
    resolved_incorrect: int
    resolved_neutral: int
    accuracy_pct: float  # 0–100; ``math.nan`` when no resolved-non-neutral rows
    window_start: str  # ISO-8601 UTC
    window_end: str  # ISO-8601 UTC
    rows_examined: int

    @property
    def resolved_total_directional(self) -> int:
        """Sum of correct + incorrect (the denominator for accuracy_pct)."""
        return int(self.resolved_correct) + int(self.resolved_incorrect)

    def to_dict(self) -> dict[str, Any]:
        return {
            "parameter_version": self.parameter_version,
            "resolved_correct": int(self.resolved_correct),
            "resolved_incorrect": int(self.resolved_incorrect),
            "resolved_neutral": int(self.resolved_neutral),
            "accuracy_pct": (
                None if math.isnan(self.accuracy_pct) else float(self.accuracy_pct)
            ),
            "window_start": self.window_start,
            "window_end": self.window_end,
            "rows_examined": int(self.rows_examined),
        }


@dataclass(frozen=True)
class DegradationResult:
    """Top-level outcome of one monitor run.

    Always carries a ``status`` from :data:`MONITOR_STATUSES` so
    CloudWatch dashboards can group runs without parsing free-form
    error strings. The numeric ``delta_pp`` is signed (positive means
    current outperforms baseline, negative means degradation).
    """

    status: str
    current: WindowAccuracy | None
    baseline: WindowAccuracy | None
    delta_pp: float | None  # current_pct - baseline_pct in percentage points
    threshold_pp: float
    message: str = ""
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "current": self.current.to_dict() if self.current is not None else None,
            "baseline": self.baseline.to_dict() if self.baseline is not None else None,
            "delta_pp": (None if self.delta_pp is None else float(self.delta_pp)),
            "threshold_pp": float(self.threshold_pp),
            "message": self.message,
            "extras": dict(self.extras),
        }


# ── Pure-function math ───────────────────────────────────────────────────


def accuracy_pct_from_bucket(summary: HistoricalValidationSummary) -> float:
    """Convert the overall bucket of a summary into a 0-100 percentage.

    Returns ``math.nan`` when ``correct + incorrect == 0`` (no
    resolved-non-neutral rows). Pure projection — exists so the
    monitor's accuracy computation cannot drift from the validation
    service's view of the same numbers.
    """
    bucket = summary.overall
    denom = int(bucket.correct) + int(bucket.incorrect)
    if denom <= 0:
        return math.nan
    return 100.0 * float(bucket.correct) / float(denom)


def detect_degradation(
    current_pct: float,
    baseline_pct: float,
    *,
    threshold_pp: float = DEFAULT_DEGRADATION_THRESHOLD_PP,
) -> tuple[bool, float]:
    """Return ``(is_degraded, delta_pp)`` for one side-by-side comparison.

    ``delta_pp = current_pct - baseline_pct``. ``is_degraded`` iff the
    delta is at most ``-threshold_pp`` (i.e. current accuracy is at
    least ``threshold_pp`` percentage points BELOW baseline). NaN on
    either side propagates to ``is_degraded=False`` — we cannot claim
    degradation without both numbers being measurable.
    """
    if math.isnan(current_pct) or math.isnan(baseline_pct):
        return False, float("nan")
    delta_pp = float(current_pct) - float(baseline_pct)
    return (delta_pp <= -abs(float(threshold_pp))), delta_pp


# ── Service entry ────────────────────────────────────────────────────────


def _build_window(
    *,
    now: datetime,
    window_days: int,
    offset_days: int = 0,
) -> tuple[datetime, datetime]:
    """Return ``(from_at, to_at)`` for a trailing-N-day window.

    ``offset_days=0`` → ``[now - window_days, now)``.
    ``offset_days=window_days`` → ``[now - 2*window_days, now - window_days)``
    (the window immediately preceding the current one).
    """
    upper = now - timedelta(days=int(offset_days))
    lower = upper - timedelta(days=int(window_days))
    return lower, upper


def _summary_for_version(
    *,
    service: HistoricalValidationService,
    parameter_version: str,
    from_at: datetime,
    to_at: datetime,
    horizon: Literal["1h", "1d"],
) -> HistoricalValidationSummary:
    """Return the summary bucket for one specific ``parameter_version``.

    Phase 2's :meth:`summarize_by_parameter_version` already returns
    ``{"__all__": summary, "v1": summary, ...}`` keyed by version, so
    we pick the relevant key here rather than re-running the math.
    Missing version key → return a synthetic empty summary so the
    accuracy reader gets a clean NaN without special-casing the absence.
    """
    by_version = service.summarize_by_parameter_version(
        user_id=None,
        from_at=from_at,
        to_at=to_at,
        horizon=horizon,
    )
    bucket = by_version.get(parameter_version)
    if bucket is not None:
        return bucket
    # No rows matched — call summarize on an empty window to get a NaN
    # bucket with the right shape, without re-querying the store.
    empty = service.summarize(
        user_id=None,
        from_at=to_at,
        to_at=to_at,  # zero-width window short-circuits to []
        horizon=horizon,
    )
    return empty


def _to_window_accuracy(
    *,
    parameter_version: str,
    summary: HistoricalValidationSummary,
    from_at: datetime,
    to_at: datetime,
) -> WindowAccuracy:
    bucket = summary.overall
    return WindowAccuracy(
        parameter_version=parameter_version,
        resolved_correct=int(bucket.correct),
        resolved_incorrect=int(bucket.incorrect),
        resolved_neutral=int(bucket.neutral),
        accuracy_pct=accuracy_pct_from_bucket(summary),
        window_start=from_at.isoformat(),
        window_end=to_at.isoformat(),
        rows_examined=int(summary.rows_examined),
    )


def evaluate_post_rotation_accuracy(
    *,
    current_parameter_version: str,
    previous_parameter_version: str | None,
    service: HistoricalValidationService,
    now: datetime | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
    horizon: Literal["1h", "1d"] = DEFAULT_HORIZON,
    min_sample: int = MIN_RESOLVED_SAMPLE,
    threshold_pp: float = DEFAULT_DEGRADATION_THRESHOLD_PP,
) -> DegradationResult:
    """Compute the live monitor decision in one call.

    The function is pure modulo the injected ``service``:

    * Pull the current-version window summary and project to
      :class:`WindowAccuracy`.
    * If a previous version exists, pull its same-shape summary over
      the window **immediately preceding** the current one (the
      most-honest baseline shape — same calendar duration, different
      version). When that baseline window has no rows at all (e.g. the
      previous version is very old), we fall back to *any* rows for
      that version inside an expanded trailing-2*window window so the
      admin still gets a meaningful comparison.
    * Apply the sample-size guard. Below the floor → ``status =
      "insufficient_sample"``.
    * Apply :func:`detect_degradation`. ``True`` → ``status = "degraded"``.
    * Otherwise → ``status = "ok"``.

    Never raises on missing data — instead it returns a structured
    status so the Lambda publisher can always emit a clean CloudWatch
    metric (or skip publishing when ``status`` is non-actionable).
    """
    run_at = now or datetime.now(timezone.utc)

    cur_from, cur_to = _build_window(now=run_at, window_days=window_days)
    cur_summary = _summary_for_version(
        service=service,
        parameter_version=current_parameter_version,
        from_at=cur_from,
        to_at=cur_to,
        horizon=horizon,
    )
    current = _to_window_accuracy(
        parameter_version=current_parameter_version,
        summary=cur_summary,
        from_at=cur_from,
        to_at=cur_to,
    )

    if not previous_parameter_version or not previous_parameter_version.strip():
        return DegradationResult(
            status="baseline_unavailable",
            current=current,
            baseline=None,
            delta_pp=None,
            threshold_pp=float(threshold_pp),
            message=(
                "No previous parameter_version available — likely the first "
                "rotation. No baseline to compare against; alarm suppressed."
            ),
            extras={"previous_parameter_version": None},
        )

    # Baseline: the same-shape window immediately preceding the current one.
    base_from, base_to = _build_window(
        now=run_at, window_days=window_days, offset_days=window_days
    )
    base_summary = _summary_for_version(
        service=service,
        parameter_version=previous_parameter_version,
        from_at=base_from,
        to_at=base_to,
        horizon=horizon,
    )
    baseline = _to_window_accuracy(
        parameter_version=previous_parameter_version,
        summary=base_summary,
        from_at=base_from,
        to_at=base_to,
    )

    # If the immediate-prior window has no rows for the previous
    # version (e.g. the rotation happened weeks ago and the previous
    # version's emission stopped immediately), fall back to a wider
    # search inside [now - 2*window_days, now) so we still produce a
    # meaningful baseline rather than silently returning
    # insufficient_sample.
    if baseline.resolved_total_directional <= 0 and baseline.rows_examined <= 0:
        wide_from, wide_to = _build_window(now=run_at, window_days=window_days * 2)
        wide_summary = _summary_for_version(
            service=service,
            parameter_version=previous_parameter_version,
            from_at=wide_from,
            to_at=wide_to,
            horizon=horizon,
        )
        baseline = _to_window_accuracy(
            parameter_version=previous_parameter_version,
            summary=wide_summary,
            from_at=wide_from,
            to_at=wide_to,
        )

    cur_sample = current.resolved_total_directional
    base_sample = baseline.resolved_total_directional
    if cur_sample < int(min_sample) or base_sample < int(min_sample):
        return DegradationResult(
            status="insufficient_sample",
            current=current,
            baseline=baseline,
            delta_pp=None,
            threshold_pp=float(threshold_pp),
            message=(
                f"Sample size below floor (min={int(min_sample)}): "
                f"current={cur_sample}, baseline={base_sample}. Alarm suppressed."
            ),
            extras={"min_sample": int(min_sample)},
        )

    is_degraded, delta_pp = detect_degradation(
        current.accuracy_pct,
        baseline.accuracy_pct,
        threshold_pp=threshold_pp,
    )
    if math.isnan(delta_pp):
        return DegradationResult(
            status="insufficient_sample",
            current=current,
            baseline=baseline,
            delta_pp=None,
            threshold_pp=float(threshold_pp),
            message=(
                "NaN accuracy on one side after sample-size gate — "
                "treating as insufficient_sample; alarm suppressed."
            ),
        )

    status = "degraded" if is_degraded else "ok"
    message = (
        f"Post-rotation accuracy delta: {delta_pp:+.2f}pp "
        f"(current={current.accuracy_pct:.2f}%, baseline={baseline.accuracy_pct:.2f}%, "
        f"threshold={threshold_pp:.2f}pp)."
    )
    return DegradationResult(
        status=status,
        current=current,
        baseline=baseline,
        delta_pp=float(delta_pp),
        threshold_pp=float(threshold_pp),
        message=message,
    )


__all__ = [
    "DEFAULT_DEGRADATION_THRESHOLD_PP",
    "DEFAULT_HORIZON",
    "DEFAULT_WINDOW_DAYS",
    "DegradationResult",
    "MIN_RESOLVED_SAMPLE",
    "MONITOR_STATUSES",
    "WindowAccuracy",
    "accuracy_pct_from_bucket",
    "detect_degradation",
    "evaluate_post_rotation_accuracy",
]
