"""Walk-forward weight optimizer for the D10 proposal-only tuning pipeline.

This is the **algorithmic core** of D10 Phase 2. It is a pure-function module
— no AWS dependencies, no IO — so the math is testable in isolation. Phase 2b
will wrap it in a Lambda handler that fetches signals from DynamoDB, runs this
optimizer per mode, and writes proposals to ``ParameterProposal``.

What this module does
---------------------

Given a chronologically-ordered list of resolved historical signals for one
trading mode (swing or day), the optimizer:

1. **Splits** the rows into train / validation windows by time (walk-forward,
   not random shuffle — random shuffles leak future information into the
   training set).
2. **Generates** a constrained grid of candidate weight sets around the
   current baseline (each layer weight ∈ ``{baseline - delta, baseline,
   baseline + delta}``, normalized so the weights still sum to 1.0).
3. **Scores** each candidate by replaying the production
   :class:`CompositeScoreEngine` against the historical layer scores stored
   on each row, producing a candidate verdict (bullish / bearish / neutral)
   per row, and comparing to the actual price direction at the resolved
   horizon.
4. **Picks** the candidate with the highest *validation* accuracy and
   reports both train and val numbers so a reviewer can spot overfitting.
5. **Gates** the proposal via :func:`accept_proposal` — the candidate is
   only worth proposing if it beats baseline val accuracy by a meaningful
   margin, validation has enough resolved signals to be statistically
   meaningful, and the regime distribution in train and val are close
   enough that the val window is a fair test of the train fit.

What this module deliberately does NOT do
-----------------------------------------

* **Verdict thresholds are not rotated.** Only the six layer weights are
  candidates. Verdict-threshold tuning has a very different change profile
  (it affects gating, not just composite score arithmetic) and is parked
  for a future audit.
* **Cross-mode weight transfer is not attempted.** Swing and day optimize
  independently — that's the entire point of the per-mode override blocks
  shipped in B30 Phase 3.
* **Multi-objective scoring is out of scope.** Phase 2 optimizes one metric
  — **directional accuracy** — using the same ``outcome_from_prices`` rule
  the live system uses (0.1% neutral threshold). Expectancy, max drawdown,
  Sharpe-equivalent, etc. are deferred. Goodhart's law applies to any
  single metric, which is why the human-in-the-loop gate exists in Phase 3.

Lossy reconstruction caveat
---------------------------

We do not persist per-layer **confidence** on the ``SignalRecord`` row — only
the per-layer score in normalized ``[-1, +1]`` range. The optimizer
reconstructs ``LayerSignal`` from the stored score with ``confidence=1.0``,
which means the optimizer's candidate verdict will not perfectly match what
the live engine produced at signal time (the live engine used the actual
confidence). This is acceptable because (a) the live engine itself was
already producing the verdict in ``SignalRecord.direction``, and (b) the
*relative* comparison between candidate weight sets is what drives the
optimizer's pick — both candidates suffer the same confidence-=1 simplifying
assumption symmetrically, so the relative ranking is preserved.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from itertools import product
from typing import Iterable

from stocvest.signals.composite_score import (
    CompositeScoreEngine,
    CompositeVerdict,
    LayerSignal,
)

# ── Layer enumeration (canonical order; mirrors CompositeParameters fields) ──
WEIGHT_LAYERS: tuple[str, ...] = (
    "technical",
    "news",
    "macro",
    "sector",
    "geopolitical",
    "internals",
)

# ── Search-space defaults ────────────────────────────────────────────────
DEFAULT_DELTA = 0.05
"""Per-layer weight perturbation step. 3 values per layer × 6 layers = 729 raw candidates."""

DEFAULT_TRAIN_FRACTION = 0.75
"""Fraction of rows allocated to the train window. 75/25 split = 6 train / 2 val on an 8-week window."""

# ── Acceptance-gate defaults ─────────────────────────────────────────────
DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT = 0.02
"""Minimum percentage-point val accuracy lift over baseline before proposing.

2pp is the load-bearing anti-overfit threshold — anything smaller than this
on a ~30-150 row val window is almost certainly noise. If you want to lower
this, lower it deliberately and update the Phase-3 admin UI's review copy.
"""

DEFAULT_MIN_VAL_SIGNAL_COUNT = 30
"""Minimum resolved signals in the val window to even consider the proposal."""

DEFAULT_REGIME_TOLERANCE = 0.20
"""Max regime-mix divergence between train and val before the proposal is rejected.

Measured as max absolute difference between train / val normalized regime
fractions. 0.20 means a regime that's 60% of train can be at most 80% or
40% of val. Bigger drifts mean the val window isn't a fair test of the
train fit.
"""

# ── Engine-mirror constants (kept in sync with signal_recorder + composite_score) ──
NEUTRAL_MOVE_PCT = 0.1
"""Mirror of ``stocvest.api.services.signal_recorder.NEUTRAL_MOVE_PCT``.

Pulled in as a module-local constant so this module stays IO-light (no
import from signal_recorder which pulls in boto3 transitively). The 0.1%
threshold is the load-bearing definition of "the price didn't move enough
to count" — both the live outcome resolver and this optimizer must apply
the same rule, or the optimizer would score candidates against a different
ground-truth definition of "actual direction" than the system later uses
when deciding whether the rotation worked.
"""


# ── Dataclasses ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class WeightSet:
    """Six per-layer weights summing to ~1.0 (normalized in :meth:`normalize`).

    The six fields mirror :class:`stocvest.config.signal_parameters.CompositeParameters`
    on purpose — converting between them is a trivial field lift, kept in
    :meth:`from_composite_block` and :meth:`to_composite_block_dict`.
    """

    technical: float
    news: float
    macro: float
    sector: float
    geopolitical: float
    internals: float

    def as_dict(self) -> dict[str, float]:
        """Return the weights as a layer-keyed dict (insertion order matches WEIGHT_LAYERS)."""
        return {
            "technical": self.technical,
            "news": self.news,
            "macro": self.macro,
            "sector": self.sector,
            "geopolitical": self.geopolitical,
            "internals": self.internals,
        }

    def sum(self) -> float:
        """Total weight; useful for the normalization check."""
        return (
            self.technical
            + self.news
            + self.macro
            + self.sector
            + self.geopolitical
            + self.internals
        )

    def normalize(self) -> "WeightSet":
        """Return a new :class:`WeightSet` whose weights sum to exactly 1.0.

        Raises :class:`ValueError` if the unnormalized sum is non-positive —
        a candidate with negative or zero total weight would produce a
        degenerate engine that always returns score 0.0.
        """
        total = self.sum()
        if total <= 0:
            raise ValueError(
                f"WeightSet sum must be positive to normalize; got {total}"
            )
        return WeightSet(
            technical=self.technical / total,
            news=self.news / total,
            macro=self.macro / total,
            sector=self.sector / total,
            geopolitical=self.geopolitical / total,
            internals=self.internals / total,
        )

    @staticmethod
    def from_composite_block(block: object) -> "WeightSet":
        """Lift a :class:`CompositeParameters` block (or duck-typed equivalent) into a :class:`WeightSet`.

        Duck-typed on the ``*_weight`` attributes; tests can substitute a
        simple object with the same field names. Production callers pass
        ``params.composite`` / ``params.swing_composite`` / ``params.day_composite``.
        """
        return WeightSet(
            technical=float(getattr(block, "technical_weight")),
            news=float(getattr(block, "news_weight")),
            macro=float(getattr(block, "macro_weight")),
            sector=float(getattr(block, "sector_weight")),
            geopolitical=float(getattr(block, "geopolitical_weight")),
            internals=float(getattr(block, "internals_weight")),
        )

    def to_composite_block_dict(
        self,
        *,
        bullish_threshold: float,
        bearish_threshold: float,
    ) -> dict[str, float]:
        """Serialize as a JSON-friendly dict matching CompositeParameters fields.

        Used by Phase 2b's Lambda handler to write the proposal's
        ``proposed_swing_composite`` / ``proposed_day_composite`` payload
        — the dict shape is what
        :func:`stocvest.config.parameter_store.signal_parameters_from_dict`
        reads back.

        Thresholds aren't optimized by this module (deliberately — see
        module docstring), so they're passed through from the baseline.
        """
        return {
            "technical_weight": self.technical,
            "news_weight": self.news,
            "macro_weight": self.macro,
            "sector_weight": self.sector,
            "geopolitical_weight": self.geopolitical,
            "internals_weight": self.internals,
            "bullish_threshold": bullish_threshold,
            "bearish_threshold": bearish_threshold,
        }


@dataclass(frozen=True)
class HistoricalSignalRow:
    """Minimal view of a resolved :class:`SignalRecord` needed for optimization.

    Phase 2b's Lambda handler will project ``SignalRecord`` rows into this
    shape — the optimizer doesn't depend on the full Pydantic model so this
    module stays import-light.

    Invariants (enforced by the projection in Phase 2b, NOT here — the
    optimizer trusts its input):

    * ``layer_scores`` carries the layer-keyed scores in the normalized
      ``[-1, +1]`` range (the same shape ``SignalRecord.layer_scores``
      stores after the live engine writes the row).
    * ``regime_for_engine`` is already translated to the engine vocabulary
      (``"bull"`` / ``"bear"`` / ``"sideways"``); use
      :func:`regime_for_engine_from_application_label` to translate from
      the application-level ``risk_on`` / ``risk_off`` / ``neutral`` /
      ``avoid`` labels stored on the row.
    * ``price_after`` is the resolved price at the optimizer's chosen
      horizon (1d for swing, can also be 1h for day-mode runs).
      ``None``-valued rows must be filtered out before reaching the
      optimizer.
    """

    layer_scores: dict[str, float]
    regime_for_engine: str
    price_at_signal: float
    price_after: float
    generated_at: datetime


@dataclass(frozen=True)
class OptimizationResult:
    """Output of one mode's grid-search run.

    All fields are JSON-friendly — the Phase-2b Lambda will project this
    directly into the ``evidence`` payload of the
    :class:`stocvest.data.parameter_proposal_store.ParameterProposal` row,
    so the admin reviewer can see exactly what the optimizer measured.
    """

    baseline_weights: WeightSet
    best_weights: WeightSet
    baseline_train_accuracy: float
    baseline_val_accuracy: float
    best_train_accuracy: float
    best_val_accuracy: float
    train_signal_count: int
    val_signal_count: int
    train_window_start: datetime
    train_window_end: datetime
    val_window_start: datetime
    val_window_end: datetime
    regime_distribution_train: dict[str, int] = field(default_factory=dict)
    regime_distribution_val: dict[str, int] = field(default_factory=dict)
    candidates_evaluated: int = 0

    def as_evidence_dict(self) -> dict[str, object]:
        """JSON-shaped payload for the proposal's ``evidence`` field."""
        return {
            "train_accuracy": self.best_train_accuracy,
            "val_accuracy": self.best_val_accuracy,
            "train_accuracy_baseline": self.baseline_train_accuracy,
            "val_accuracy_baseline": self.baseline_val_accuracy,
            "train_signal_count": self.train_signal_count,
            "val_signal_count": self.val_signal_count,
            "regime_distribution_train": dict(self.regime_distribution_train),
            "regime_distribution_val": dict(self.regime_distribution_val),
            "candidates_evaluated": self.candidates_evaluated,
            "baseline_weights": self.baseline_weights.as_dict(),
            "best_weights": self.best_weights.as_dict(),
            "train_window_start": self.train_window_start.isoformat(),
            "train_window_end": self.train_window_end.isoformat(),
            "val_window_start": self.val_window_start.isoformat(),
            "val_window_end": self.val_window_end.isoformat(),
        }


@dataclass(frozen=True)
class ProposalAcceptance:
    """Result of the acceptance-gate check.

    ``reason`` is a short plain-English string explaining the decision.
    For Phase 3, the admin UI will surface this on the proposal-review page
    so the reviewer can see WHY the optimizer flagged the candidate.
    """

    accepted: bool
    reason: str


# ── Engine-mirror helpers ────────────────────────────────────────────────


def outcome_from_prices(direction: str, price_at: float, price_after: float | None) -> str:
    """Mirror of ``stocvest.api.services.signal_recorder.outcome_from_prices``.

    Returns ``"correct" | "incorrect" | "neutral"`` for a predicted direction
    against an actual price move. Kept module-local so this optimizer module
    has no IO-layer dependencies (signal_recorder pulls in botocore).

    Anyone changing the live function MUST also change this one — the test
    :func:`tests.signals.test_weight_optimizer.test_outcome_from_prices_mirrors_signal_recorder`
    pins the equivalence so a drift gets caught loud.
    """
    if price_after is None or price_at <= 0:
        return "neutral"
    move_pct = abs((price_after - price_at) / price_at) * 100.0
    if move_pct <= NEUTRAL_MOVE_PCT:
        return "neutral"
    d = direction.lower()
    if d == "bullish":
        return "correct" if price_after > price_at else "incorrect"
    if d == "bearish":
        return "correct" if price_after < price_at else "incorrect"
    return "neutral"


def regime_for_engine_from_application_label(label: str | None) -> str:
    """Translate an application-level regime label into the engine vocabulary.

    Mirror of the private ``_regime_for_engine`` helpers in
    ``swing_composite_engine`` and ``real_composite_engine``. Kept module-local
    for the same reason as :func:`outcome_from_prices` — no IO imports.
    """
    m = (label or "").strip().lower()
    if m in ("risk_on", "bullish", "bull"):
        return "bull"
    if m in ("risk_off", "bearish", "bear", "avoid"):
        return "bear"
    return "sideways"


# ── Scoring ──────────────────────────────────────────────────────────────


def score_weight_candidate(
    rows: list[HistoricalSignalRow],
    weights: WeightSet,
    *,
    bullish_threshold: float = 0.20,
    bearish_threshold: float = -0.20,
) -> float:
    """Compute directional accuracy of a candidate weight set on a row list.

    Replays the production :class:`CompositeScoreEngine` against each row's
    stored ``layer_scores`` with the candidate weights, derives the candidate
    verdict, and compares to the actual price direction using
    :func:`outcome_from_prices`. Accuracy = correct / (correct + incorrect);
    neutral outcomes are excluded from the denominator (no position taken =
    no risk taken = neither right nor wrong).

    Returns ``0.0`` when the row set produces zero non-neutral outcomes —
    an empty denominator is interpreted as "no information", not a perfect
    score.
    """
    engine = CompositeScoreEngine(
        base_weights=weights.as_dict(),
        bullish_threshold=bullish_threshold,
        bearish_threshold=bearish_threshold,
    )
    correct = 0
    incorrect = 0
    for row in rows:
        signals = [
            LayerSignal(layer=layer, score=float(score), confidence=1.0)
            for layer, score in row.layer_scores.items()
        ]
        if not signals:
            continue
        composite = engine.compute(signals, regime=row.regime_for_engine)
        verdict_str = _verdict_to_str(composite.verdict)
        outcome = outcome_from_prices(verdict_str, row.price_at_signal, row.price_after)
        if outcome == "correct":
            correct += 1
        elif outcome == "incorrect":
            incorrect += 1
        # outcome == "neutral" is excluded — see docstring.
    total_directional = correct + incorrect
    if total_directional == 0:
        return 0.0
    return correct / total_directional


def _verdict_to_str(verdict: CompositeVerdict) -> str:
    """Map :class:`CompositeVerdict` enum to the lower-case string the outcome rule expects."""
    if verdict == CompositeVerdict.BULLISH:
        return "bullish"
    if verdict == CompositeVerdict.BEARISH:
        return "bearish"
    return "neutral"


# ── Walk-forward split + regime stats ────────────────────────────────────


def walk_forward_split(
    rows: list[HistoricalSignalRow],
    *,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
) -> tuple[list[HistoricalSignalRow], list[HistoricalSignalRow]]:
    """Split rows chronologically into (train, val).

    Rows MUST be pre-sorted by ``generated_at`` ascending — the optimizer
    asserts this via a defensive check that catches at least the all-or-nothing
    case (last row's timestamp < first row's). Random shuffles are
    deliberately not supported: random splits leak future information into the
    training set, defeating the walk-forward defense against overfitting.

    Returns ``([], [])`` when ``rows`` is empty; the caller must check this
    before invoking the optimizer.
    """
    if not rows:
        return ([], [])
    if not 0.0 < train_fraction < 1.0:
        raise ValueError(
            f"train_fraction must be in (0, 1); got {train_fraction}"
        )
    # Defensive: catch the obviously-wrong "rows not sorted" case loud.
    if rows[0].generated_at > rows[-1].generated_at:
        raise ValueError(
            "rows must be sorted by generated_at ascending before walk_forward_split; "
            "first row is newer than last row"
        )
    split_idx = max(1, int(len(rows) * train_fraction))
    return rows[:split_idx], rows[split_idx:]


def regime_distribution(rows: Iterable[HistoricalSignalRow]) -> dict[str, int]:
    """Count rows by ``regime_for_engine`` value. Empty input returns ``{}``."""
    out: dict[str, int] = {}
    for r in rows:
        key = r.regime_for_engine
        out[key] = out.get(key, 0) + 1
    return out


def regime_distributions_match(
    train_dist: dict[str, int],
    val_dist: dict[str, int],
    *,
    tolerance: float = DEFAULT_REGIME_TOLERANCE,
) -> bool:
    """Return True when train and val regime mixes are close enough.

    Compares normalized fractions per regime; if any regime's fraction differs
    by more than ``tolerance``, returns False. The default tolerance of 0.20
    means a regime that's 60% of train can be at most 80% or as little as 40%
    of val — anything wider and the val window isn't a fair test.

    Returns True when either side is empty (the caller's job to check signal
    counts separately — we don't want this gate firing on a zero-rows edge
    case and short-circuiting more informative errors).
    """
    train_total = sum(train_dist.values())
    val_total = sum(val_dist.values())
    if train_total == 0 or val_total == 0:
        return True
    # Compare normalized fractions on the union of regime keys.
    keys = set(train_dist.keys()) | set(val_dist.keys())
    for k in keys:
        train_frac = train_dist.get(k, 0) / train_total
        val_frac = val_dist.get(k, 0) / val_total
        if abs(train_frac - val_frac) > tolerance:
            return False
    return True


# ── Candidate generation ─────────────────────────────────────────────────


def generate_candidate_weights(
    baseline: WeightSet,
    *,
    delta: float = DEFAULT_DELTA,
) -> list[WeightSet]:
    """Generate the constrained grid neighborhood around ``baseline``.

    Each layer weight is perturbed independently with ``{−delta, 0, +delta}``,
    producing 3^6 = 729 raw candidates. Each candidate is then:

    * filtered to drop any layer weight that would go ≤ 0 (negative weights
      are meaningless),
    * normalized so the six weights sum to exactly 1.0,
    * deduplicated against previously-emitted candidates by rounded-weight
      fingerprint (the +delta/−delta perturbations on multiple layers can
      produce the same normalized result).

    The baseline itself is always included as the first candidate so the
    optimizer can report "baseline beats every perturbation" as a clean
    no-op when no rotation is justified.
    """
    if delta <= 0:
        raise ValueError(f"delta must be positive; got {delta}")
    seen: set[tuple[float, ...]] = set()
    out: list[WeightSet] = []
    baseline_norm = baseline.normalize()
    out.append(baseline_norm)
    seen.add(_fingerprint(baseline_norm))

    perturbations = (-delta, 0.0, delta)
    for combo in product(perturbations, repeat=len(WEIGHT_LAYERS)):
        candidate = WeightSet(
            technical=baseline.technical + combo[0],
            news=baseline.news + combo[1],
            macro=baseline.macro + combo[2],
            sector=baseline.sector + combo[3],
            geopolitical=baseline.geopolitical + combo[4],
            internals=baseline.internals + combo[5],
        )
        if any(w <= 0 for w in candidate.as_dict().values()):
            continue
        try:
            normalized = candidate.normalize()
        except ValueError:
            continue
        fp = _fingerprint(normalized)
        if fp in seen:
            continue
        seen.add(fp)
        out.append(normalized)
    return out


def _fingerprint(weights: WeightSet) -> tuple[float, ...]:
    """Stable rounded-weight tuple for set-deduplication (4 decimal places).

    Two normalized weight sets that differ by < 1e-4 per layer are treated
    as the same candidate. This guards against floating-point drift between
    arithmetically-equivalent normalization paths.
    """
    return tuple(round(w, 4) for w in weights.as_dict().values())


# ── Acceptance gate ──────────────────────────────────────────────────────


def accept_proposal(
    result: OptimizationResult,
    *,
    min_val_accuracy_improvement: float = DEFAULT_MIN_VAL_ACCURACY_IMPROVEMENT,
    min_val_signal_count: int = DEFAULT_MIN_VAL_SIGNAL_COUNT,
    regime_tolerance: float = DEFAULT_REGIME_TOLERANCE,
) -> ProposalAcceptance:
    """Apply the acceptance gate to an optimization result.

    Three independent gates, ANY failure rejects the proposal:

    1. **Val signal count** ≥ ``min_val_signal_count``. Default 30: small
       validation windows are noisy, and the optimizer is happy to pick
       a candidate that beats baseline on 5 rows by 30pp purely by accident.
    2. **Val accuracy improvement** ≥ ``min_val_accuracy_improvement``
       (default 2pp). The candidate must beat baseline by a clinically
       meaningful margin, not just edge it out at the 4th decimal place.
    3. **Regime distribution match** between train and val (within
       ``regime_tolerance``). Otherwise the val window is testing a
       different regime than the train window optimized for, and the lift
       is regime-arbitrage, not real signal.

    Returns a :class:`ProposalAcceptance` with ``accepted=False`` and a
    plain-English ``reason`` when any gate fails — the Phase-3 admin UI
    surfaces this verbatim so a reviewer can see WHY the optimizer
    rejected the candidate (or, when ``accepted=True``, the reason
    summarizes the improvement).
    """
    if result.val_signal_count < min_val_signal_count:
        return ProposalAcceptance(
            accepted=False,
            reason=(
                f"val window has {result.val_signal_count} resolved signals, "
                f"below the {min_val_signal_count}-row minimum"
            ),
        )
    val_lift = result.best_val_accuracy - result.baseline_val_accuracy
    if val_lift < min_val_accuracy_improvement:
        return ProposalAcceptance(
            accepted=False,
            reason=(
                f"val accuracy lift {val_lift:+.3f} below the +"
                f"{min_val_accuracy_improvement:.2f} threshold"
            ),
        )
    if not regime_distributions_match(
        result.regime_distribution_train,
        result.regime_distribution_val,
        tolerance=regime_tolerance,
    ):
        return ProposalAcceptance(
            accepted=False,
            reason=(
                "regime distribution diverges between train and val by more than "
                f"{regime_tolerance:.2f}; val is not a fair test of the train fit"
            ),
        )
    return ProposalAcceptance(
        accepted=True,
        reason=(
            f"val accuracy lift {val_lift:+.3f} over baseline "
            f"({result.baseline_val_accuracy:.3f} → {result.best_val_accuracy:.3f}); "
            f"n_val={result.val_signal_count}"
        ),
    )


# ── Top-level entry point ────────────────────────────────────────────────


def optimize_weights_for_mode(
    rows: list[HistoricalSignalRow],
    baseline: WeightSet,
    *,
    delta: float = DEFAULT_DELTA,
    train_fraction: float = DEFAULT_TRAIN_FRACTION,
    bullish_threshold: float = 0.20,
    bearish_threshold: float = -0.20,
) -> OptimizationResult:
    """Run the walk-forward grid search on a single mode's rows.

    Returns an :class:`OptimizationResult` even when no candidate beats the
    baseline — the result will then have ``best_weights == baseline_weights``
    and val accuracies equal. The acceptance gate
    (:func:`accept_proposal`) is what decides whether to propose.

    ``rows`` MUST be sorted by ``generated_at`` ascending. Empty ``rows``
    raises :class:`ValueError` — calling the optimizer on no data is
    almost certainly a bug in the Phase-2b handler, not something to
    silently no-op on.
    """
    if not rows:
        raise ValueError(
            "optimize_weights_for_mode called with no rows; the caller should "
            "filter to only mode-matched + resolved rows BEFORE invoking the optimizer"
        )

    train_rows, val_rows = walk_forward_split(rows, train_fraction=train_fraction)
    # We need at least one row on each side for the train/val accuracy
    # numbers to be defined; a degenerate empty val set would make
    # baseline_val_accuracy zero and silently pass anything.
    if not train_rows or not val_rows:
        raise ValueError(
            f"walk_forward_split produced an empty side "
            f"(train={len(train_rows)}, val={len(val_rows)}); need more rows"
        )

    candidates = generate_candidate_weights(baseline, delta=delta)
    baseline_norm = baseline.normalize()

    baseline_train_acc = score_weight_candidate(
        train_rows,
        baseline_norm,
        bullish_threshold=bullish_threshold,
        bearish_threshold=bearish_threshold,
    )
    baseline_val_acc = score_weight_candidate(
        val_rows,
        baseline_norm,
        bullish_threshold=bullish_threshold,
        bearish_threshold=bearish_threshold,
    )

    best_weights = baseline_norm
    best_val_acc = baseline_val_acc
    best_train_acc = baseline_train_acc

    for cand in candidates:
        # Skip the baseline — already scored.
        if _fingerprint(cand) == _fingerprint(baseline_norm):
            continue
        cand_val_acc = score_weight_candidate(
            val_rows,
            cand,
            bullish_threshold=bullish_threshold,
            bearish_threshold=bearish_threshold,
        )
        # Strict > so we don't pick a candidate that merely ties baseline.
        if cand_val_acc > best_val_acc:
            cand_train_acc = score_weight_candidate(
                train_rows,
                cand,
                bullish_threshold=bullish_threshold,
                bearish_threshold=bearish_threshold,
            )
            best_weights = cand
            best_val_acc = cand_val_acc
            best_train_acc = cand_train_acc

    return OptimizationResult(
        baseline_weights=baseline_norm,
        best_weights=best_weights,
        baseline_train_accuracy=baseline_train_acc,
        baseline_val_accuracy=baseline_val_acc,
        best_train_accuracy=best_train_acc,
        best_val_accuracy=best_val_acc,
        train_signal_count=len(train_rows),
        val_signal_count=len(val_rows),
        train_window_start=train_rows[0].generated_at,
        train_window_end=train_rows[-1].generated_at,
        val_window_start=val_rows[0].generated_at,
        val_window_end=val_rows[-1].generated_at,
        regime_distribution_train=regime_distribution(train_rows),
        regime_distribution_val=regime_distribution(val_rows),
        candidates_evaluated=len(candidates),
    )
