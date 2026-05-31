"""
Product KPI — canonical cohort for official directional-accuracy reporting.

This module encodes the single mechanical definition of "what we recommended to
clients" so admin UI, API, and future public surfaces cannot drift:

    capture_kind == qualified
    AND decision_state_entry == actionable  (inferred when legacy-empty)
    AND ledger_qualified == true

Accuracy uses resolved non-neutral outcomes only:
    correct / (correct + incorrect)

See ``historical_validation`` for the broader D2 stratification surface; this
module is the narrow product-success scorecard with coverage, decision frontier,
and parameter-version promotion rules.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

from stocvest.api.services.signal_backtest_capture import (
    infer_capture_kind,
    infer_decision_state_entry,
)
from stocvest.data.models import SignalRecord
from stocvest.signals.historical_validation import (
    BucketStats,
    HistoricalValidationSummary,
    Horizon,
    _bucket_stats,
    _environment_key,
    _outcome_for_horizon,
    _readiness_key,
    validate_signal_history,
)

# Rolling windows (days) — primary KPI uses 90; secondary trends optional in API.
PRODUCT_KPI_DEFAULT_WINDOW_DAYS = 90
PRODUCT_KPI_SECONDARY_WINDOWS = (30, 180)

# Minimum resolved non-neutral rows before publishing headline accuracy.
PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL = 50

# Per-engine Wilson interval on public mode cards (Mode Separation — not a combined headline).
PRODUCT_KPI_MIN_MODE_RESOLVED_FOR_CI = 5

# Public / marketing contract: qualified actionable, 1d, rolling 90d.
PUBLIC_PRODUCT_KPI_HORIZON: Horizon = "1d"
PUBLIC_PRODUCT_KPI_WINDOW_DAYS = 90

# Parameter-version promotion gates (internal).
PROMOTION_MIN_RESOLVED = 30
PROMOTION_MIN_VOLUME_RATIO = 0.80

# Coverage floor — alert when qualified actionable flow drops below this rate.
MIN_SIGNALS_PER_WEEK_WARNING = 2.0

SCORE_BAND_KEYS = ("below_70", "70_74", "75_79", "80_plus")
ALIGNMENT_BAND_KEYS = ("below_52", "52_60", "60_plus", "unknown")
READINESS_BAND_KEYS = ("low", "moderate", "high")


def is_product_kpi_cohort_row(record: SignalRecord) -> bool:
    """Row is in the product recommendation cohort (outcome may still be pending)."""

    if infer_capture_kind(record) != "qualified":
        return False
    if not record.ledger_qualified:
        return False
    decision = infer_decision_state_entry(record, eligible=record.ledger_qualified)
    return decision == "actionable"


def is_product_kpi_scored_row(record: SignalRecord, *, horizon: Horizon) -> bool:
    """Cohort row with resolved non-neutral outcome (accuracy denominator)."""

    if not is_product_kpi_cohort_row(record):
        return False
    outcome = _outcome_for_horizon(record, horizon)
    return outcome is not None and outcome != "neutral"


def filter_product_kpi_cohort(records: Iterable[SignalRecord]) -> list[SignalRecord]:
    return [r for r in records if is_product_kpi_cohort_row(r)]


def _score_band(record: SignalRecord) -> str:
    score = int(record.signal_strength)
    if score < 70:
        return "below_70"
    if score < 75:
        return "70_74"
    if score < 80:
        return "75_79"
    return "80_plus"


def _alignment_ratio(record: SignalRecord) -> float | None:
    raw = record.gate_status_json
    if not raw or not str(raw).strip():
        return None
    try:
        blob: Any = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(blob, dict):
        return None
    gates = blob.get("gates")
    if not isinstance(gates, dict):
        return None
    alignment = gates.get("alignment")
    if isinstance(alignment, dict) and alignment.get("value") is not None:
        try:
            return float(alignment["value"])
        except (TypeError, ValueError):
            return None
    return None


def _alignment_band(record: SignalRecord) -> str:
    ar = _alignment_ratio(record)
    if ar is None:
        return "unknown"
    if ar < 0.52:
        return "below_52"
    if ar < 0.60:
        return "52_60"
    return "60_plus"


def _stratify_frontier(
    cohort: list[SignalRecord],
    *,
    horizon: Horizon,
    keys: tuple[str, ...],
    key_fn,
) -> dict[str, BucketStats]:
    grouped: dict[str, list[SignalRecord]] = {k: [] for k in keys}
    other: list[SignalRecord] = []
    for rec in cohort:
        key = key_fn(rec)
        if key in grouped:
            grouped[key].append(rec)
        else:
            other.append(rec)
    out = {k: _bucket_stats(rows, horizon) for k, rows in grouped.items()}
    if other:
        out["other"] = _bucket_stats(other, horizon)
    return out


@dataclass(frozen=True)
class AccuracyWithInterval:
    """Directional accuracy plus optional Wilson 95% interval (0..1)."""

    stats: BucketStats
    ci_low: float | None = None
    ci_high: float | None = None


@dataclass(frozen=True)
class ProductKpiCoverage:
    """Opportunity / flow metrics alongside accuracy."""

    window_calendar_days: int
    cohort_rows: int
    pending_outcome: int
    resolved_non_neutral: int
    signals_per_week: float
    days_with_signal: int
    day_coverage_pct: float
    trading_days_in_window: int
    days_with_signal_et: int
    trading_day_coverage_pct: float
    coverage_low: bool
    min_signals_per_week_warning: float


@dataclass(frozen=True)
class VersionPromotionVerdict:
    candidate_version: str
    prior_version: str
    promoted: bool
    reasons: tuple[str, ...]
    candidate_resolved: int
    prior_resolved: int
    candidate_accuracy: float
    prior_accuracy: float
    volume_ratio: float | None


@dataclass(frozen=True)
class ProductKpiSummary:
    """Official product scorecard for one horizon + window."""

    horizon: Horizon
    cohort_definition: str
    accuracy: AccuracyWithInterval
    coverage: ProductKpiCoverage
    meets_minimum_sample: bool
    minimum_resolved_required: int
    stratified: HistoricalValidationSummary
    by_score_band: dict[str, BucketStats]
    by_alignment_band: dict[str, BucketStats]
    by_readiness_band: dict[str, BucketStats]
    by_environment: dict[str, BucketStats]
    parameter_versions: tuple[str, ...] = field(default_factory=tuple)


def _calendar_days(from_at: datetime, to_at: datetime) -> int:
    from_d = _to_utc(from_at).date()
    to_d = _to_utc(to_at).date()
    return max(1, (to_d - from_d).days)


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def wilson_score_interval(
    correct: int,
    incorrect: int,
    *,
    z: float = 1.96,
) -> tuple[float, float] | None:
    """Wilson score 95% interval for a binomial proportion (returns 0..1)."""

    n = correct + incorrect
    if n <= 0:
        return None
    phat = correct / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (phat + z2 / (2.0 * n)) / denom
    margin = (z / denom) * math.sqrt((phat * (1.0 - phat) + z2 / (4.0 * n)) / n)
    return (max(0.0, center - margin), min(1.0, center + margin))


def _days_with_signal(cohort: list[SignalRecord]) -> int:
    days: set[date] = set()
    for rec in cohort:
        days.add(_to_utc(rec.generated_at).date())
    return len(days)


def _et_date(dt: datetime) -> date:
    return _to_utc(dt).astimezone(_ET).date()


def _days_with_signal_et(cohort: list[SignalRecord]) -> int:
    return len({_et_date(rec.generated_at) for rec in cohort})


def _trading_days_in_window(from_at: datetime, to_at: datetime) -> int:
    """Count NYSE regular-session days in ``[from_at, to_at)`` (ET dates)."""

    from stocvest.data.nyse_calendar import count_nyse_trading_days

    start = _et_date(from_at)
    end = _et_date(to_at)
    return count_nyse_trading_days(start, end)


def summarize_product_kpi(
    records: Iterable[SignalRecord],
    *,
    horizon: Horizon,
    from_at: datetime,
    to_at: datetime,
    minimum_resolved: int = PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL,
) -> ProductKpiSummary:
    """Build the official product KPI summary for ``[from_at, to_at)``."""

    all_rows = list(records)
    cohort = filter_product_kpi_cohort(all_rows)
    calendar_days = _calendar_days(from_at, to_at)
    resolved_nn = sum(1 for r in cohort if is_product_kpi_scored_row(r, horizon=horizon))
    pending = sum(
        1
        for r in cohort
        if _outcome_for_horizon(r, horizon) is None
    )
    days_sig = _days_with_signal(cohort)
    days_sig_et = _days_with_signal_et(cohort)
    trading_days = _trading_days_in_window(from_at, to_at)
    weeks = max(calendar_days / 7.0, 1.0)
    signals_per_week = round(len(cohort) / weeks, 2)

    bucket = _bucket_stats(cohort, horizon)
    interval = wilson_score_interval(bucket.correct, bucket.incorrect)
    accuracy = AccuracyWithInterval(
        stats=bucket,
        ci_low=interval[0] if interval else None,
        ci_high=interval[1] if interval else None,
    )
    stratified = validate_signal_history(cohort, horizon=horizon)
    versions = tuple(sorted({(r.parameter_version or "unknown").strip() or "unknown" for r in cohort}))

    coverage = ProductKpiCoverage(
        window_calendar_days=calendar_days,
        cohort_rows=len(cohort),
        pending_outcome=pending,
        resolved_non_neutral=resolved_nn,
        signals_per_week=signals_per_week,
        days_with_signal=days_sig,
        day_coverage_pct=round(100.0 * days_sig / calendar_days, 1) if calendar_days else 0.0,
        trading_days_in_window=trading_days,
        days_with_signal_et=days_sig_et,
        trading_day_coverage_pct=(
            round(100.0 * days_sig_et / trading_days, 1) if trading_days else 0.0
        ),
        coverage_low=signals_per_week < MIN_SIGNALS_PER_WEEK_WARNING,
        min_signals_per_week_warning=MIN_SIGNALS_PER_WEEK_WARNING,
    )

    return ProductKpiSummary(
        horizon=horizon,
        cohort_definition=(
            "capture_kind=qualified AND decision_state_entry=actionable "
            "AND ledger_qualified=true"
        ),
        accuracy=accuracy,
        coverage=coverage,
        meets_minimum_sample=resolved_nn >= minimum_resolved,
        minimum_resolved_required=minimum_resolved,
        stratified=stratified,
        by_score_band=_stratify_frontier(
            cohort, horizon=horizon, keys=SCORE_BAND_KEYS, key_fn=_score_band
        ),
        by_alignment_band=_stratify_frontier(
            cohort, horizon=horizon, keys=ALIGNMENT_BAND_KEYS, key_fn=_alignment_band
        ),
        by_readiness_band=_stratify_frontier(
            cohort, horizon=horizon, keys=READINESS_BAND_KEYS, key_fn=_readiness_key
        ),
        by_environment=_stratify_frontier(
            cohort,
            horizon=horizon,
            keys=("normal", "elevated", "stressed", "crisis", "unknown"),
            key_fn=_environment_key,
        ),
        parameter_versions=versions,
    )


def summarize_product_kpi_by_version(
    records: Iterable[SignalRecord],
    *,
    horizon: Horizon,
    from_at: datetime,
    to_at: datetime,
    minimum_resolved: int = PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL,
) -> dict[str, ProductKpiSummary]:
    """Per ``parameter_version`` product KPI (plus ``__all__`` combined)."""

    cohort = filter_product_kpi_cohort(records)
    per: dict[str, list[SignalRecord]] = {"__all__": list(cohort)}
    for row in cohort:
        key = (row.parameter_version or "").strip() or "unknown"
        per.setdefault(key, []).append(row)

    return {
        version: summarize_product_kpi(
            rows,
            horizon=horizon,
            from_at=from_at,
            to_at=to_at,
            minimum_resolved=minimum_resolved,
        )
        for version, rows in per.items()
    }


def evaluate_version_promotion(
    *,
    candidate: ProductKpiSummary,
    prior: ProductKpiSummary,
    min_resolved: int = PROMOTION_MIN_RESOLVED,
    min_volume_ratio: float = PROMOTION_MIN_VOLUME_RATIO,
) -> VersionPromotionVerdict:
    """Strict promotion rule: accuracy up, volume not collapsed, enough samples."""

    c_res = candidate.coverage.resolved_non_neutral
    p_res = prior.coverage.resolved_non_neutral
    c_acc = candidate.accuracy.stats.accuracy
    p_acc = prior.accuracy.stats.accuracy

    reasons: list[str] = []
    if c_res < min_resolved:
        reasons.append(f"candidate resolved {c_res} < {min_resolved}")
    if p_res < min_resolved:
        reasons.append(f"prior resolved {p_res} < {min_resolved}")
    if math.isnan(c_acc) or math.isnan(p_acc):
        reasons.append("accuracy undefined (insufficient non-neutral outcomes)")
    vol_ratio: float | None = None
    if p_res > 0:
        vol_ratio = c_res / p_res
        if vol_ratio < min_volume_ratio:
            reasons.append(
                f"volume ratio {vol_ratio:.2f} < {min_volume_ratio:.2f}"
            )
    elif candidate.coverage.cohort_rows < prior.coverage.cohort_rows * min_volume_ratio:
        reasons.append("cohort volume collapsed vs prior")

    if not math.isnan(c_acc) and not math.isnan(p_acc) and c_acc < p_acc:
        reasons.append(
            f"accuracy {c_acc:.3f} < prior {p_acc:.3f}"
        )

    return VersionPromotionVerdict(
        candidate_version=",".join(candidate.parameter_versions) or "unknown",
        prior_version=",".join(prior.parameter_versions) or "unknown",
        promoted=len(reasons) == 0,
        reasons=tuple(reasons),
        candidate_resolved=c_res,
        prior_resolved=p_res,
        candidate_accuracy=c_acc,
        prior_accuracy=p_acc,
        volume_ratio=vol_ratio,
    )


def _bucket_stats_to_dict(stats: BucketStats) -> dict[str, Any]:
    return {
        "total_signals": stats.total_signals,
        "correct": stats.correct,
        "incorrect": stats.incorrect,
        "neutral": stats.neutral,
        "resolved": stats.resolved,
        "accuracy": None if math.isnan(stats.accuracy) else stats.accuracy,
    }


def _bucket_stats_with_mode_ci(
    stats: BucketStats,
    *,
    min_resolved: int = PRODUCT_KPI_MIN_MODE_RESOLVED_FOR_CI,
) -> dict[str, Any]:
    """Mode bucket plus Wilson CI when that engine has enough resolved outcomes."""

    out = _bucket_stats_to_dict(stats)
    n = stats.correct + stats.incorrect
    if n < min_resolved:
        out["accuracy_ci_low_percent"] = None
        out["accuracy_ci_high_percent"] = None
        return out
    interval = wilson_score_interval(stats.correct, stats.incorrect)
    if interval is None:
        out["accuracy_ci_low_percent"] = None
        out["accuracy_ci_high_percent"] = None
        return out
    out["accuracy_ci_low_percent"] = round(interval[0] * 100.0, 1)
    out["accuracy_ci_high_percent"] = round(interval[1] * 100.0, 1)
    return out


def _validation_summary_to_dict(summary: HistoricalValidationSummary) -> dict[str, Any]:
    return {
        "horizon": summary.horizon,
        "overall": _bucket_stats_to_dict(summary.overall),
        "by_decision": {k: _bucket_stats_to_dict(v) for k, v in summary.by_decision.items()},
        "by_regime": {k: _bucket_stats_to_dict(v) for k, v in summary.by_regime.items()},
        "by_mode": {k: _bucket_stats_to_dict(v) for k, v in summary.by_mode.items()},
        "by_pattern": {k: _bucket_stats_to_dict(v) for k, v in summary.by_pattern.items()},
        "by_readiness": {k: _bucket_stats_to_dict(v) for k, v in summary.by_readiness.items()},
        "by_direction": {k: _bucket_stats_to_dict(v) for k, v in summary.by_direction.items()},
        "by_environment": {k: _bucket_stats_to_dict(v) for k, v in summary.by_environment.items()},
        "by_capture_kind": {k: _bucket_stats_to_dict(v) for k, v in summary.by_capture_kind.items()},
        "rows_examined": summary.rows_examined,
        "parameter_versions": list(summary.parameter_versions),
    }


def product_kpi_summary_to_dict(summary: ProductKpiSummary) -> dict[str, Any]:
    """JSON-safe serialization for API handlers."""

    def _acc_dict(stats: BucketStats) -> dict[str, Any]:
        return _bucket_stats_to_dict(stats)

    cov = summary.coverage
    acc_wrap = summary.accuracy
    stats = acc_wrap.stats
    denom = stats.correct + stats.incorrect
    accuracy_pct = (
        None
        if denom == 0 or math.isnan(stats.accuracy)
        else round(stats.accuracy * 100.0, 1)
    )
    ci_low_pct = (
        None
        if acc_wrap.ci_low is None
        else round(acc_wrap.ci_low * 100.0, 1)
    )
    ci_high_pct = (
        None
        if acc_wrap.ci_high is None
        else round(acc_wrap.ci_high * 100.0, 1)
    )

    return {
        "horizon": summary.horizon,
        "cohort_definition": summary.cohort_definition,
        "meets_minimum_sample": summary.meets_minimum_sample,
        "minimum_resolved_required": summary.minimum_resolved_required,
        "accuracy": {
            **_acc_dict(stats),
            "accuracy_percent": accuracy_pct,
            "accuracy_ci_low_percent": ci_low_pct,
            "accuracy_ci_high_percent": ci_high_pct,
            "resolved_non_neutral": cov.resolved_non_neutral,
        },
        "coverage": {
            "window_calendar_days": cov.window_calendar_days,
            "cohort_rows": cov.cohort_rows,
            "pending_outcome": cov.pending_outcome,
            "resolved_non_neutral": cov.resolved_non_neutral,
            "signals_per_week": cov.signals_per_week,
            "days_with_signal": cov.days_with_signal,
            "day_coverage_pct": cov.day_coverage_pct,
            "trading_days_in_window": cov.trading_days_in_window,
            "days_with_signal_et": cov.days_with_signal_et,
            "trading_day_coverage_pct": cov.trading_day_coverage_pct,
            "coverage_low": cov.coverage_low,
            "min_signals_per_week_warning": cov.min_signals_per_week_warning,
        },
        "stratified": _validation_summary_to_dict(summary.stratified),
        "by_score_band": {k: _acc_dict(v) for k, v in summary.by_score_band.items()},
        "by_alignment_band": {k: _acc_dict(v) for k, v in summary.by_alignment_band.items()},
        "by_readiness_band": {k: _acc_dict(v) for k, v in summary.by_readiness_band.items()},
        "by_environment": {k: _acc_dict(v) for k, v in summary.by_environment.items()},
        "parameter_versions": list(summary.parameter_versions),
    }


def public_validation_summary_dict(
    summary: HistoricalValidationSummary,
    *,
    kpi: ProductKpiSummary,
) -> dict[str, Any]:
    """Trimmed public projection: product KPI cohort only."""

    return {
        "horizon": summary.horizon,
        "overall": _bucket_stats_to_dict(summary.overall),
        "by_mode": {
            k: _bucket_stats_with_mode_ci(v) for k, v in summary.by_mode.items()
        },
        "rows_examined": summary.rows_examined,
        "cohort_definition": kpi.cohort_definition,
        "meets_minimum_sample": kpi.meets_minimum_sample,
        "minimum_resolved_required": kpi.minimum_resolved_required,
        "resolved_non_neutral": kpi.coverage.resolved_non_neutral,
        "cohort_rows": kpi.coverage.cohort_rows,
        "pending_outcome": kpi.coverage.pending_outcome,
        "signals_per_week": kpi.coverage.signals_per_week,
        "coverage_low": kpi.coverage.coverage_low,
        "trading_days_in_window": kpi.coverage.trading_days_in_window,
        "trading_day_coverage_pct": kpi.coverage.trading_day_coverage_pct,
        "accuracy_ci_low_percent": (
            None
            if kpi.accuracy.ci_low is None
            else round(kpi.accuracy.ci_low * 100.0, 1)
        ),
        "accuracy_ci_high_percent": (
            None
            if kpi.accuracy.ci_high is None
            else round(kpi.accuracy.ci_high * 100.0, 1)
        ),
    }


def performance_summary_from_product_kpi_records(
    records: list[SignalRecord],
    *,
    horizon: Horizon = "1d",
) -> dict[str, Any]:
    """Public ``/performance`` summary — product KPI cohort only."""

    from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
    from stocvest.api.services.signal_recorder import _et_today, _signal_calendar_date_et

    cohort = filter_product_kpi_cohort(records)
    launch_date = _et_today()
    if cohort:
        launch_date = min(_signal_calendar_date_et(r) for r in cohort)

    evaluated = [
        r
        for r in cohort
        if _outcome_for_horizon(r, horizon) is not None
    ]
    scored = [r for r in cohort if is_product_kpi_scored_row(r, horizon=horizon)]
    correct = sum(1 for r in scored if _outcome_for_horizon(r, horizon) == "correct")
    incorrect = sum(1 for r in scored if _outcome_for_horizon(r, horizon) == "incorrect")
    neutral = sum(
        1
        for r in evaluated
        if _outcome_for_horizon(r, horizon) == "neutral"
    )
    denom = correct + incorrect
    meets = len(scored) >= PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL
    accuracy = round((correct / denom) * 100.0, 1) if denom > 0 and meets else None
    days = max(0, (_et_today() - launch_date).days)

    return {
        "total_signals_tracked": len(cohort),
        "signals_evaluated": len(evaluated),
        "resolved_non_neutral": len(scored),
        "correct_direction_count": correct,
        "incorrect_direction_count": incorrect,
        "neutral_direction_count": neutral,
        "directional_accuracy_percent": accuracy,
        "meets_minimum_sample": meets,
        "minimum_resolved_required": PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL,
        "cohort_definition": (
            "capture_kind=qualified AND decision_state_entry=actionable "
            "AND ledger_qualified=true"
        ),
        "launch_date": launch_date.isoformat(),
        "date_range_days": days,
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


def promotion_verdict_to_dict(verdict: VersionPromotionVerdict) -> dict[str, Any]:
    def _pct(acc: float) -> float | None:
        return None if math.isnan(acc) else round(acc * 100.0, 1)

    return {
        "candidate_version": verdict.candidate_version,
        "prior_version": verdict.prior_version,
        "promoted": verdict.promoted,
        "reasons": list(verdict.reasons),
        "candidate_resolved": verdict.candidate_resolved,
        "prior_resolved": verdict.prior_resolved,
        "candidate_accuracy_percent": _pct(verdict.candidate_accuracy),
        "prior_accuracy_percent": _pct(verdict.prior_accuracy),
        "volume_ratio": verdict.volume_ratio,
    }


__all__ = [
    "PRODUCT_KPI_DEFAULT_WINDOW_DAYS",
    "PRODUCT_KPI_MIN_RESOLVED_NON_NEUTRAL",
    "PUBLIC_PRODUCT_KPI_HORIZON",
    "PUBLIC_PRODUCT_KPI_WINDOW_DAYS",
    "PROMOTION_MIN_RESOLVED",
    "PROMOTION_MIN_VOLUME_RATIO",
    "ProductKpiCoverage",
    "ProductKpiSummary",
    "VersionPromotionVerdict",
    "evaluate_version_promotion",
    "filter_product_kpi_cohort",
    "is_product_kpi_cohort_row",
    "is_product_kpi_scored_row",
    "performance_summary_from_product_kpi_records",
    "product_kpi_summary_to_dict",
    "promotion_verdict_to_dict",
    "public_validation_summary_dict",
    "summarize_product_kpi",
    "summarize_product_kpi_by_version",
]
