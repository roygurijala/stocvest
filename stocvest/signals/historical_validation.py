"""
Historical Signal Validation — D2 (Phase 1: pure aggregation).

What this module is
-------------------
Given a collection of ``SignalRecord`` rows that the live ``signal_recorder.resolve_signals``
pipeline has already populated with ``outcome_1h`` / ``outcome_1d`` directional labels, this
module produces a ``HistoricalValidationSummary`` stratified by:

- Decision state at entry (actionable / monitor / blocked)
- Macro regime at entry (risk_on / neutral / risk_off / avoid)
- Trading mode (swing / day)
- Pattern / setup family (e.g. swing_composite, ORB, VWAP)
- Trade Readiness bucket (high / moderate / low) derived from ``signal_strength`` 0–100
- Direction (bullish / bearish / neutral)

Why "Historical Signal Validation" and not "Backtest"
-----------------------------------------------------
The STOCVEST Assistant prompt — and the marketing / disclosure surface — uses the phrase
"Historical signal accuracy does not guarantee future results" verbatim. The product
deliberately avoids the word "backtest" as a marketing claim because:

1. Backtesting implies *generating* synthetic signals against historical data, which would
   require a clean historical archive of news / macro / sector / geopolitical / internals
   state — STOCVEST does not maintain one and never will retro-fit it.
2. The legal framing is much weaker when you say "we replayed the model on bars we already
   had" vs. "we measured what the live system actually produced and how it resolved".

This module does the second thing only. Every row counted here is a real signal that the
production engine emitted at the time, captured into ``SignalHistory`` at emission, and
resolved against real subsequent prices. Nothing is reconstructed.

Phase 1 scope (this commit)
---------------------------
Pure, deterministic aggregation over an in-memory list of ``SignalRecord``. No DynamoDB
reads, no API surface, no UI. The next phases plug this into the existing live pipeline:

- Phase 2: a small service layer that pulls a date-range slice from ``SignalHistory`` and
  builds a ``HistoricalValidationSummary`` per ``parameter_version``.
- Phase 3: ``GET /v1/signals/historical-validation/...`` endpoints; user UI moved to
  setup analytics (B46); D2 stratified view at ``/dashboard/admin/historical-validation``.
- Phase 4: cross-version diffs (parameter A vs. B) so the validation page can show the
  effect of a rules change without ever simulating new signals.

What is intentionally NOT in this module
----------------------------------------
- Win rate, expectancy, dollar P&L. The product never publishes these. ``BucketStats`` is
  *directional accuracy only* — the same metric ``/performance`` shows today.
- Re-resolution at longer horizons (T+5d, T+10d, T+30d). Adding longer horizons requires
  Polygon historical bars and lives in the service layer, not here.
- Anything that interprets validation as a forecast. Aggregate stats describe past behavior
  under the recorded rules and nothing else.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Literal

from stocvest.data.models import SignalRecord

# ── Public domain literals ─────────────────────────────────────────────────────────────

Horizon = Literal["1h", "1d"]
DirectionalOutcome = Literal["correct", "incorrect", "neutral"]

#: Decision-state values that ship today. ``unknown`` is reserved for legacy rows where the
#: validation-ledger columns were not yet being populated when the signal was emitted.
DECISION_STATES: tuple[str, ...] = ("actionable", "monitor", "blocked", "unknown")

#: Macro regime values as they are stored in ``regime_label_at_entry``. The engine writes
#: the lowercase / engine form (``risk_on`` / ``neutral`` / ``risk_off`` / ``avoid``); the
#: UI separately maps them to Bullish / Neutral / Bearish for display. We stratify on the
#: engine form because that is what is actually in the column.
REGIMES: tuple[str, ...] = ("risk_on", "neutral", "risk_off", "avoid", "unknown")

TRADING_MODES: tuple[str, ...] = ("swing", "day")

READINESS_BUCKETS: tuple[str, ...] = ("high", "moderate", "low")

DIRECTIONS: tuple[str, ...] = ("bullish", "bearish", "neutral")

# ── Result shapes ──────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BucketStats:
    """Directional-accuracy stats for one stratum.

    ``accuracy`` is ``correct / (correct + incorrect)``. Neutral outcomes are excluded from
    the denominator on purpose: this matches the existing public performance summary so the
    historical view and the live tracked-outcomes view can never disagree on the same data.

    When there are no resolved-non-neutral rows (``correct + incorrect == 0``) we return
    ``accuracy = math.nan`` rather than ``0.0`` so the UI can render "—" instead of an
    incorrect "0% accurate" claim.
    """

    total_signals: int
    correct: int
    incorrect: int
    neutral: int
    accuracy: float

    @property
    def resolved(self) -> int:
        """Number of rows with a directional outcome (correct/incorrect/neutral)."""

        return self.correct + self.incorrect + self.neutral


@dataclass(frozen=True)
class HistoricalValidationSummary:
    """Top-level aggregate plus every stratification.

    The summary is immutable. Build a new one for every horizon you want to publish.
    """

    horizon: Horizon
    overall: BucketStats
    by_decision: dict[str, BucketStats]
    by_regime: dict[str, BucketStats]
    by_mode: dict[str, BucketStats]
    by_pattern: dict[str, BucketStats]
    by_readiness: dict[str, BucketStats]
    by_direction: dict[str, BucketStats]
    #: Optional convenience: how many rows were considered in total (including ones with no
    #: outcome yet). The UI uses this to render "X signals resolved out of Y" alongside the
    #: accuracy number.
    rows_examined: int = 0
    #: Set of ``parameter_version`` strings observed in the input. The validation page
    #: surfaces this so users can see exactly which rules-bundle the number describes.
    parameter_versions: tuple[str, ...] = field(default_factory=tuple)


# ── Internal helpers ───────────────────────────────────────────────────────────────────


def _outcome_for_horizon(record: SignalRecord, horizon: Horizon) -> str | None:
    """Pick the right outcome column for the requested horizon."""

    if horizon == "1h":
        return record.outcome_1h
    if horizon == "1d":
        return record.outcome_1d
    return None


def _decision_key(record: SignalRecord) -> str:
    """Map ``decision_state_entry`` onto one of the canonical buckets.

    Records emitted before the validation-ledger columns were added are bucketed as
    ``unknown`` so they do not silently vanish from the totals.
    """

    raw = (record.decision_state_entry or "").strip().lower()
    if raw in ("actionable", "monitor", "blocked"):
        return raw
    return "unknown"


def _regime_key(record: SignalRecord) -> str:
    raw = (record.regime_label_at_entry or "").strip().lower()
    if raw in ("risk_on", "neutral", "risk_off", "avoid"):
        return raw
    return "unknown"


def _readiness_key(record: SignalRecord) -> str:
    """Bucket Trade Readiness (``signal_strength`` 0–100) onto high/moderate/low.

    Thresholds match the existing Evidence card conventions: 70+ is "high" readiness, 40–69
    is "moderate", below 40 is "low". This module does not invent a new scale.
    """

    score = int(record.signal_strength)
    if score >= 70:
        return "high"
    if score >= 40:
        return "moderate"
    return "low"


def _bucket_stats(records: Iterable[SignalRecord], horizon: Horizon) -> BucketStats:
    """Tally ``correct`` / ``incorrect`` / ``neutral`` for one stratum."""

    correct = incorrect = neutral = total = 0
    for rec in records:
        outcome = _outcome_for_horizon(rec, horizon)
        if outcome is None:
            continue
        total += 1
        if outcome == "correct":
            correct += 1
        elif outcome == "incorrect":
            incorrect += 1
        elif outcome == "neutral":
            neutral += 1

    denom = correct + incorrect
    accuracy = math.nan if denom == 0 else correct / denom
    return BucketStats(
        total_signals=total,
        correct=correct,
        incorrect=incorrect,
        neutral=neutral,
        accuracy=accuracy,
    )


def _stratify(
    records: list[SignalRecord],
    *,
    horizon: Horizon,
    keys: Iterable[str],
    key_fn,
) -> dict[str, BucketStats]:
    """Group ``records`` by ``key_fn`` and emit a ``BucketStats`` for each declared key.

    Buckets the caller did not declare are still aggregated under ``other`` so unexpected
    values (a new regime label, a new setup pattern) are visible in the output instead of
    silently dropped.
    """

    declared = set(keys)
    grouped: dict[str, list[SignalRecord]] = {key: [] for key in declared}
    other: list[SignalRecord] = []
    for rec in records:
        key = key_fn(rec)
        if key in declared:
            grouped[key].append(rec)
        else:
            other.append(rec)

    out: dict[str, BucketStats] = {key: _bucket_stats(rows, horizon) for key, rows in grouped.items()}
    if other:
        out["other"] = _bucket_stats(other, horizon)
    return out


# ── Public API ─────────────────────────────────────────────────────────────────────────


def validate_signal_history(
    records: Iterable[SignalRecord],
    *,
    horizon: Horizon = "1h",
) -> HistoricalValidationSummary:
    """Aggregate directional accuracy across ``records`` for one horizon.

    Args:
        records: Any iterable of ``SignalRecord``. Rows missing an outcome for the chosen
            horizon are still counted in ``rows_examined`` but contribute zero to the
            ``BucketStats`` for that horizon — that is the whole point of stratifying by
            horizon rather than by record.
        horizon: ``"1h"`` (intraday follow-through) or ``"1d"`` (next-session direction).

    Returns:
        A frozen ``HistoricalValidationSummary``. Callers are expected to publish at least
        the ``overall`` bucket on the public ``/performance`` surface and the full
        stratification on the authenticated ``/dashboard/signal-validation`` surface.
    """

    records_list = list(records)
    overall = _bucket_stats(records_list, horizon)

    by_decision = _stratify(
        records_list, horizon=horizon, keys=DECISION_STATES, key_fn=_decision_key
    )
    by_regime = _stratify(
        records_list, horizon=horizon, keys=REGIMES, key_fn=_regime_key
    )
    by_mode = _stratify(
        records_list, horizon=horizon, keys=TRADING_MODES, key_fn=lambda r: (r.mode or "").lower()
    )
    by_pattern = _stratify(
        records_list,
        horizon=horizon,
        # ``swing_composite`` is the default seeded on emit; the other patterns are emitted
        # by the day-trading scanner. We pre-declare the common ones so the UI gets stable
        # keys; anything else lands under ``other`` and is still visible.
        keys=("swing_composite", "orb", "vwap", "momentum", "gap_with_catalyst"),
        key_fn=lambda r: (r.pattern or "").lower(),
    )
    by_readiness = _stratify(
        records_list, horizon=horizon, keys=READINESS_BUCKETS, key_fn=_readiness_key
    )
    by_direction = _stratify(
        records_list, horizon=horizon, keys=DIRECTIONS, key_fn=lambda r: (r.direction or "").lower()
    )

    versions = sorted({r.parameter_version for r in records_list if r.parameter_version})

    return HistoricalValidationSummary(
        horizon=horizon,
        overall=overall,
        by_decision=by_decision,
        by_regime=by_regime,
        by_mode=by_mode,
        by_pattern=by_pattern,
        by_readiness=by_readiness,
        by_direction=by_direction,
        rows_examined=len(records_list),
        parameter_versions=tuple(versions),
    )


__all__ = [
    "BucketStats",
    "HistoricalValidationSummary",
    "Horizon",
    "DirectionalOutcome",
    "DECISION_STATES",
    "REGIMES",
    "TRADING_MODES",
    "READINESS_BUCKETS",
    "DIRECTIONS",
    "validate_signal_history",
]
