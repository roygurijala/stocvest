"""Orchestration for the D10 Phase 2b scheduled weight-proposal worker.

This module is the bridge between the pure-function optimizer
(:mod:`stocvest.signals.weight_optimizer`) and the data layer (parameter
store, signal recorder, proposal store). It is what the Lambda handler in
:mod:`stocvest.api.handlers.weight_proposer` calls.

End-to-end flow per invocation:

1. Load the current :class:`SignalParameters` from Secrets Manager via
   :class:`ParameterStore` (read-only — the worker's IAM role has NO
   ``secretsmanager:UpdateSecret`` permission, by design).
2. Scan :class:`SignalHistory` for resolved signal records and project
   them into :class:`HistoricalSignalRow` per trading mode (swing / day),
   chronologically sorted, with rows outside the trailing-N-day window
   filtered out.
3. For each mode independently, run
   :func:`optimize_weights_for_mode` → :func:`accept_proposal`.
4. For each mode whose result passed the acceptance gate, write a new
   ``pending`` :class:`ParameterProposal` to DynamoDB. The proposal
   carries the baseline and proposed per-mode composite blocks (as
   JSON-serializable dicts) plus the optimizer's full evidence payload
   so a reviewer in Phase 3 can see exactly what the optimizer measured.
5. Return a structured summary covering both modes — accepted, rejected,
   or errored — so CloudWatch logs (and future operator dashboards) can
   surface what happened.

Failure isolation: each mode runs independently. A boto3 ClientError in
the day-mode signal scan does not block the swing-mode run from
completing, and a ZeroDivisionError in the swing optimizer does not
block the day proposal from being written. Per-mode errors are caught
and surfaced in the summary's ``error`` field.

This module is intentionally synchronous (no asyncio). The scheduled job
is a low-frequency batch worker (weekly cadence per the EventBridge
rule), so the simplicity of a top-down sync flow outweighs any latency
benefit from parallelizing the two modes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.signal_backtest_capture import infer_capture_kind
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.models import SignalRecord
from stocvest.data.parameter_proposal_store import (
    ParameterProposal,
    ParameterProposalStore,
)
from stocvest.signals.composite_score import resolve_composite_block
from stocvest.signals.weight_optimizer import (
    DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT,
    DEFAULT_MIN_VAL_SIGNAL_COUNT,
    DEFAULT_REGIME_TOLERANCE,
    DEFAULT_TRAIN_FRACTION,
    HistoricalSignalRow,
    OptimizationResult,
    ProposalAcceptance,
    WeightSet,
    accept_proposal,
    optimize_weights_for_mode,
    regime_for_engine_from_application_label,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


# Modes the optimizer runs for. ``"swing"`` first so the swing proposal
# always appears before the day proposal in the summary log.
_MODES: tuple[str, ...] = ("swing", "day")

# Default lookback window for the row scan.
DEFAULT_TRAILING_DAYS = 60

# Default outcome horizon to grade signals on. Both modes default to 1d:
# - swing signals are explicitly multi-day, so 1d is the natural metric.
# - day signals close intraday but ``outcome_1d`` still measures whether
#   the direction call worked across the session; using a consistent
#   horizon makes the cross-mode comparison coherent. Admins can override
#   to ``"1h"`` for day mode by invoking the orchestrator directly.
DEFAULT_HORIZON = "1d"


# ── Dataclasses ──────────────────────────────────────────────────────────


@dataclass
class ModeRunOutcome:
    """Per-mode result of one orchestrator run.

    The orchestrator returns one of these per mode regardless of outcome:
    the structure carries enough information for a reviewer to understand
    what happened without reading CloudWatch logs.
    """

    mode: str
    rows_evaluated: int = 0
    optimization_result: OptimizationResult | None = None
    acceptance: ProposalAcceptance | None = None
    proposal_id: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """JSON-friendly summary for the Lambda response body."""
        out: dict[str, Any] = {
            "mode": self.mode,
            "rows_evaluated": self.rows_evaluated,
        }
        if self.optimization_result is not None:
            out["optimization_result"] = self.optimization_result.as_evidence_dict()
        if self.acceptance is not None:
            out["accepted"] = self.acceptance.accepted
            out["reason"] = self.acceptance.reason
        if self.proposal_id is not None:
            out["proposal_id"] = self.proposal_id
        if self.error is not None:
            out["error"] = self.error
        return out


@dataclass
class ProposalRunSummary:
    """Top-level result of one orchestrator invocation."""

    run_at: datetime
    mode_outcomes: list[ModeRunOutcome] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_at": self.run_at.isoformat(),
            "modes": [o.to_dict() for o in self.mode_outcomes],
            "proposals_written": sum(1 for o in self.mode_outcomes if o.proposal_id),
        }


# ── Projection: SignalRecord → HistoricalSignalRow ───────────────────────


def _post_horizon_price(record: SignalRecord, horizon: str) -> float | None:
    """Pick the resolved price for the chosen horizon. Returns None if unresolved."""
    if horizon == "1h":
        return record.price_1h_after
    return record.price_1d_after


def _is_resolved_at(record: SignalRecord, horizon: str) -> bool:
    """Lightweight resolution check — both the outcome label and post-price must exist."""
    if horizon == "1h":
        return bool(record.resolved_1h) and record.price_1h_after is not None
    return bool(record.resolved_1d) and record.price_1d_after is not None


def _is_weight_optimizer_eligible(record: SignalRecord) -> bool:
    """Exclude study telemetry and rows without a real technical pattern.

    Shadow ledger-capture rows (gate audit / retry duplicates) and
    ``unavailable`` patterns (no technical setup) pollute walk-forward fits
    without representing actionable product signals.
    """
    if infer_capture_kind(record) == "shadow":
        return False
    pattern = (record.pattern or "").strip().lower()
    if pattern == "unavailable" or pattern.startswith("unavailable:"):
        return False
    return True


def build_historical_rows_for_mode(
    records: list[SignalRecord],
    *,
    mode: str,
    horizon: str = DEFAULT_HORIZON,
    now: datetime,
    trailing_days: int = DEFAULT_TRAILING_DAYS,
) -> list[HistoricalSignalRow]:
    """Project resolved :class:`SignalRecord` rows into the optimizer's input shape.

    Filters in this order (each is intentional):

    * **Mode match** — only rows whose ``mode`` matches the requested mode.
      The optimizer is explicitly mode-scoped (B30 architecture).
    * **Resolution** — only rows resolved at the requested horizon (the
      ``resolved_1h`` / ``resolved_1d`` flag is true AND the
      ``price_*_after`` field is non-null). Unresolved rows can't grade
      a candidate's verdict — there's no actual price direction to
      compare to.
    * **Time window** — only rows ``generated_at`` within
      ``(now - trailing_days, now]``. Tighter than the regression-test
      "any resolved row" net because regime stationarity assumptions
      break down on year-old data.
    * **Non-empty layer_scores** — a row with no stored layer scores
      can't be re-scored; the live engine would have skipped it too.
    * **Optimizer eligibility** — excludes shadow ledger-capture rows and
      ``unavailable`` patterns (no technical setup) so the fit cohort
      reflects real signal quality, not gate-study telemetry.

    Returns rows **sorted by ``generated_at`` ascending** so
    :func:`walk_forward_split` can apply its chronological invariant
    directly. The optimizer's defensive sort check passes by construction.
    """
    if mode not in _MODES:
        raise ValueError(f"unknown mode {mode!r}; expected one of {_MODES}")
    if trailing_days <= 0:
        raise ValueError(f"trailing_days must be positive; got {trailing_days}")

    cutoff = now - timedelta(days=trailing_days)
    out: list[HistoricalSignalRow] = []
    for rec in records:
        if rec.mode != mode:
            continue
        if not _is_weight_optimizer_eligible(rec):
            continue
        if not _is_resolved_at(rec, horizon):
            continue
        if not rec.layer_scores:
            continue
        if rec.generated_at < cutoff or rec.generated_at > now:
            continue
        price_after = _post_horizon_price(rec, horizon)
        if price_after is None:
            # Belt-and-suspenders — _is_resolved_at already checks this.
            continue
        regime_label = (
            rec.regime_label_at_entry
            or rec.market_regime_exit
            or ""
        )
        regime_for_engine = regime_for_engine_from_application_label(regime_label)
        out.append(
            HistoricalSignalRow(
                layer_scores=dict(rec.layer_scores),
                regime_for_engine=regime_for_engine,
                price_at_signal=float(rec.price_at_signal),
                price_after=float(price_after),
                generated_at=rec.generated_at,
            )
        )
    out.sort(key=lambda r: r.generated_at)
    return out


# ── Baseline + proposed-block lift ───────────────────────────────────────


def load_baseline_for_mode(
    params: SignalParameters, mode: str
) -> tuple[WeightSet, float, float]:
    """Resolve the active composite block for ``mode`` and lift it.

    Routes through :func:`resolve_composite_block` — same single-source
    helper the live engines use (B30 Phase 3). When the secret has a
    per-mode override block, that override is returned; otherwise the
    shared ``composite`` block is the baseline.

    Returns ``(WeightSet, bullish_threshold, bearish_threshold)``. The
    thresholds aren't optimized in Phase 2a, but the optimizer needs them
    to derive verdicts when scoring candidates, and the proposal carries
    them through unchanged so the promoted block is well-formed.
    """
    block = resolve_composite_block(params, mode)
    weights = WeightSet.from_composite_block(block)
    bullish = float(getattr(block, "bullish_threshold"))
    bearish = float(getattr(block, "bearish_threshold"))
    return weights, bullish, bearish


# ── Per-mode orchestration ───────────────────────────────────────────────


def _run_one_mode(
    mode: str,
    *,
    params: SignalParameters,
    records: list[SignalRecord],
    now: datetime,
    trailing_days: int,
    horizon: str,
    min_val_signal_count: int,
    min_val_accuracy_improvement: float,
    regime_tolerance: float,
    train_fraction: float,
    proposal_store: ParameterProposalStore | None,
) -> ModeRunOutcome:
    """Run one mode's slice end-to-end. Returns a :class:`ModeRunOutcome`.

    All exceptions are caught and surfaced via ``error``. The orchestrator
    is a scheduled worker — a single bad mode must NOT block the other
    mode from producing a proposal.
    """
    outcome = ModeRunOutcome(mode=mode)
    try:
        rows = build_historical_rows_for_mode(
            records,
            mode=mode,
            horizon=horizon,
            now=now,
            trailing_days=trailing_days,
        )
        outcome.rows_evaluated = len(rows)
        if not rows:
            outcome.error = (
                f"no resolved rows for mode {mode!r} in the trailing "
                f"{trailing_days}-day window"
            )
            return outcome

        baseline, bullish, bearish = load_baseline_for_mode(params, mode)
        result = optimize_weights_for_mode(
            rows,
            baseline,
            train_fraction=train_fraction,
            bullish_threshold=bullish,
            bearish_threshold=bearish,
        )
        outcome.optimization_result = result

        decision = accept_proposal(
            result,
            min_val_accuracy_improvement=min_val_accuracy_improvement,
            min_val_signal_count=min_val_signal_count,
            regime_tolerance=regime_tolerance,
        )
        outcome.acceptance = decision

        if not decision.accepted:
            return outcome
        if proposal_store is None:
            outcome.error = "acceptance gate passed but no proposal_store provided; skipping write"
            return outcome

        proposed_block = result.best_weights.to_composite_block_dict(
            bullish_threshold=bullish,
            bearish_threshold=bearish,
        )
        evidence_for_mode = {mode: result.as_evidence_dict()}
        # ``ParameterProposal.new_pending`` requires both ``proposed_swing_composite``
        # and ``proposed_day_composite`` as keyword args (one will be None for a
        # single-mode proposal — the factory's invariant is "at least one of the
        # two must be non-None", not "exactly one").
        swing_block: dict[str, Any] | None = proposed_block if mode == "swing" else None
        day_block: dict[str, Any] | None = proposed_block if mode == "day" else None
        proposal = ParameterProposal.new_pending(
            baseline_parameter_version=str(params.version or "unknown"),
            proposed_swing_composite=swing_block,
            proposed_day_composite=day_block,
            train_window_start=result.train_window_start.isoformat(),
            train_window_end=result.train_window_end.isoformat(),
            val_window_start=result.val_window_start.isoformat(),
            val_window_end=result.val_window_end.isoformat(),
            evidence=evidence_for_mode,
            created_by_job="weight_proposer_scheduled",
        )
        proposal_store.put(proposal)
        outcome.proposal_id = proposal.proposal_id
    except Exception as exc:  # pragma: no cover — defensive net for the scheduled worker
        _LOG.exception("weight_proposer mode=%s failed: %s", mode, exc)
        outcome.error = f"{type(exc).__name__}: {exc}"
    return outcome


# ── Top-level entry point ────────────────────────────────────────────────


def run_weight_proposer(
    *,
    parameter_store: type[ParameterStore] | None = None,
    proposal_store: ParameterProposalStore | None = None,
    records: list[SignalRecord] | None = None,
    now: datetime | None = None,
    trailing_days: int = DEFAULT_TRAILING_DAYS,
    horizon: str = DEFAULT_HORIZON,
    min_val_signal_count: int = DEFAULT_MIN_VAL_SIGNAL_COUNT,
    min_val_accuracy_improvement: float = DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT,
    regime_tolerance: float = DEFAULT_REGIME_TOLERANCE,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
) -> ProposalRunSummary:
    """Top-level orchestrator for the scheduled weight-proposal worker.

    All collaborators are injectable so the function is testable without
    hitting AWS:

    * ``parameter_store`` — class (not instance) exposing
      ``get_parameters_sync()``. Defaults to :class:`ParameterStore`.
    * ``proposal_store`` — :class:`ParameterProposalStore` instance.
      ``None`` runs the optimizer and gating but skips writes (used by
      the lock-in tests that don't want to assert on DDB calls).
    * ``records`` — pre-loaded list of :class:`SignalRecord`. When ``None``,
      the orchestrator lazy-imports the production signal recorder and
      scans the full table — only the deployed Lambda should leave this
      empty; tests should always pass synthetic records.

    All gate thresholds and the train/val ratio are pass-through to
    keep the orchestrator agnostic of the optimizer's defaults — admins
    can tune the gate via the Lambda's environment variables in a
    future revision without re-deploying.
    """
    run_at = now or datetime.now(timezone.utc)
    summary = ProposalRunSummary(run_at=run_at)

    pstore_cls = parameter_store if parameter_store is not None else ParameterStore
    try:
        params = pstore_cls.get_parameters_sync()
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("weight_proposer parameter load failed: %s", exc)
        for mode in _MODES:
            summary.mode_outcomes.append(
                ModeRunOutcome(mode=mode, error=f"parameter load failed: {exc}")
            )
        return summary

    if records is None:
        # Defer the import so tests don't pull in boto3 transitively.
        from stocvest.api.services.signal_recorder import get_signal_recorder

        rec = get_signal_recorder()
        try:
            records = rec.scan_all_records()
        except Exception as exc:  # pragma: no cover — defensive
            _LOG.exception("weight_proposer scan_all_records failed: %s", exc)
            for mode in _MODES:
                summary.mode_outcomes.append(
                    ModeRunOutcome(mode=mode, error=f"signal scan failed: {exc}")
                )
            return summary

    for mode in _MODES:
        summary.mode_outcomes.append(
            _run_one_mode(
                mode,
                params=params,
                records=records,
                now=run_at,
                trailing_days=trailing_days,
                horizon=horizon,
                min_val_signal_count=min_val_signal_count,
                min_val_accuracy_improvement=min_val_accuracy_improvement,
                regime_tolerance=regime_tolerance,
                train_fraction=train_fraction,
                proposal_store=proposal_store,
            )
        )

    proposals_written = sum(1 for o in summary.mode_outcomes if o.proposal_id)
    _LOG.info(
        "weight_proposer run complete: rows_evaluated=%s proposals_written=%s",
        sum(o.rows_evaluated for o in summary.mode_outcomes),
        proposals_written,
    )
    return summary
