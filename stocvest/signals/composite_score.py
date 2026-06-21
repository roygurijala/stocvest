"""
Phase 2d: Signal weighting and composite score.

Contributor contract (do not collapse these stages):
  **Stage A — per-layer truth:** Each analyzer (`*_analyzer.py`) produces a
  domain-specific read from its own inputs. Composite goals must not leak back
  into layer logic.
  **Stage B — decision synthesis:** This module combines Stage-A outputs into a
  reconciled scalar verdict, preserving disagreement (alignment metadata,
  contradiction penalty) rather than hiding it.

Regime multipliers scale **influence** (effective weight), not the sign of the
layer’s directional score: keep `REGIME_WEIGHTS` values strictly positive unless
an explicit ADR allows otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from stocvest.signals.signal_math_contract import (
    DIRECTIONAL_SCORE_MAX,
    DIRECTIONAL_SCORE_MIN,
    DIRECTIONAL_VERDICT_THRESHOLD,
    UNIT_MAX,
    UNIT_MIN,
    directional_sign,
)


class CompositeVerdict(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


@dataclass(frozen=True)
class LayerSignal:
    """
    Directional signal from one layer.

    score range: -1.0 (strong bearish) to +1.0 (strong bullish)
    confidence range: 0.0 to 1.0
    """

    layer: str
    score: float
    confidence: float


@dataclass(frozen=True)
class LayerContribution:
    layer: str
    raw_score: float
    confidence: float
    base_weight: float
    regime_multiplier: float
    effective_weight: float
    weighted_value: float


@dataclass(frozen=True)
class CompositeSignal:
    score: float
    confidence: float
    verdict: CompositeVerdict
    contributions: list[LayerContribution]
    alignment_ratio: float = 1.0
    conflicted_layers: list[str] = field(default_factory=list)
    aligned_weight: float = 0.0
    conflicted_weight: float = 0.0


# Phase-2 layer set from project decisions:
# Technical + News + Sector + Macro + Geopolitical + Internals
# NOTE: These values must stay in sync with CompositeParameters field defaults in
# stocvest/config/signal_parameters.py. Previously they diverged (news 0.18 vs 0.20,
# macro 0.16 vs 0.15, geopolitical 0.12 vs 0.10, internals 0.12 vs 0.10), causing
# the no-args engine path used in tests to score against a different table than
# production. Always update BOTH locations together.
DEFAULT_BASE_WEIGHTS: dict[str, float] = {
    "technical": 0.30,
    "news": 0.20,
    "sector": 0.15,
    "macro": 0.15,
    "geopolitical": 0.10,
    "internals": 0.10,
}

# Regime multipliers are applied on top of base weights.
# Keys are intentionally explicit and stable for downstream consumers.
REGIME_WEIGHTS: dict[str, dict[str, float]] = {
    "bull": {
        "technical": 1.20,
        "news": 1.05,
        "sector": 1.10,
        "macro": 0.95,
        "geopolitical": 0.90,
        "internals": 1.00,
    },
    "bear": {
        "technical": 1.00,
        "news": 1.15,
        "sector": 1.05,
        "macro": 1.15,
        "geopolitical": 1.20,
        "internals": 1.05,
    },
    "sideways": {
        "technical": 1.00,
        "news": 1.00,
        "sector": 1.00,
        "macro": 1.00,
        "geopolitical": 1.00,
        "internals": 1.00,
    },
}


class CompositeScoreEngine:
    """Combine layer signals into a final normalized composite signal."""

    def __init__(
        self,
        *,
        base_weights: dict[str, float] | None = None,
        regime_weights: dict[str, dict[str, float]] | None = None,
        bullish_threshold: float = DIRECTIONAL_VERDICT_THRESHOLD,
        bearish_threshold: float = -DIRECTIONAL_VERDICT_THRESHOLD,
    ) -> None:
        self._base_weights = dict(base_weights or DEFAULT_BASE_WEIGHTS)
        self._regime_weights = dict(regime_weights or REGIME_WEIGHTS)
        self._bullish_threshold = bullish_threshold
        self._bearish_threshold = bearish_threshold

    def compute(
        self,
        signals: list[LayerSignal],
        regime: str = "sideways",
        *,
        sensitivity_multipliers: dict[str, float] | None = None,
    ) -> CompositeSignal:
        """Combine layer signals into a normalized composite verdict.

        ``sensitivity_multipliers`` is an optional per-layer **influence** scaler
        (B71 per-symbol News/Geo sensitivity). It multiplies a layer's effective
        weight *before* renormalization, so it only changes how much a layer
        contributes to the blend — never the layer's directional sign, and never
        a hard gate. Omitted / ``1.0`` entries leave behavior byte-identical to
        the pre-B71 engine. Values are clamped to ``[0.1, 2.0]`` as a guardrail.
        """
        if not signals:
            return CompositeSignal(
                score=0.0,
                confidence=0.0,
                verdict=CompositeVerdict.NEUTRAL,
                contributions=[],
                alignment_ratio=1.0,
                conflicted_layers=[],
                aligned_weight=0.0,
                conflicted_weight=0.0,
            )

        multipliers = self._regime_weights.get(regime, self._regime_weights["sideways"])
        sensitivity = sensitivity_multipliers or {}

        contributions: list[LayerContribution] = []
        weighted_sum = 0.0
        total_effective_weight = 0.0
        confidence_sum = 0.0
        total_confidence_weight = 0.0
        layer_effective_weights: dict[str, float] = {}

        for signal in signals:
            score = self._clamp(signal.score, DIRECTIONAL_SCORE_MIN, DIRECTIONAL_SCORE_MAX)
            confidence = self._clamp(signal.confidence, UNIT_MIN, UNIT_MAX)
            base_weight = self._base_weights.get(signal.layer, 0.0)
            regime_multiplier = multipliers.get(signal.layer, 1.0)
            layer_sensitivity = self._clamp(float(sensitivity.get(signal.layer, 1.0)), 0.1, 2.0)

            effective_weight = base_weight * regime_multiplier * confidence * layer_sensitivity
            layer_effective_weights[signal.layer] = effective_weight
            weighted_value = score * effective_weight
            confidence_weight = base_weight * regime_multiplier

            weighted_sum += weighted_value
            total_effective_weight += effective_weight
            confidence_sum += confidence_weight * confidence
            total_confidence_weight += confidence_weight

            contributions.append(
                LayerContribution(
                    layer=signal.layer,
                    raw_score=score,
                    confidence=confidence,
                    base_weight=base_weight,
                    regime_multiplier=regime_multiplier,
                    effective_weight=effective_weight,
                    weighted_value=weighted_value,
                )
            )

        if total_effective_weight == 0:
            final_score = 0.0
        else:
            final_score = self._clamp(
                weighted_sum / total_effective_weight, DIRECTIONAL_SCORE_MIN, DIRECTIONAL_SCORE_MAX
            )

        if total_confidence_weight == 0:
            final_confidence = 0.0
        else:
            final_confidence = self._clamp(confidence_sum / total_confidence_weight, UNIT_MIN, UNIT_MAX)

        raw_verdict = self._to_verdict(final_score)
        preliminary_alignment = self._alignment_meta(signals, raw_verdict, regime, layer_effective_weights)
        final_score = self._apply_contradiction_penalty(final_score, preliminary_alignment["ratio"])
        verdict = self._to_verdict(final_score)
        alignment = self._alignment_meta(signals, verdict, regime, layer_effective_weights)
        return CompositeSignal(
            score=round(final_score, 4),
            confidence=round(final_confidence, 4),
            verdict=verdict,
            contributions=contributions,
            alignment_ratio=round(float(alignment["ratio"]), 4),
            conflicted_layers=list(alignment["conflicted_layers"]),
            aligned_weight=round(float(alignment["aligned_weight"]), 4),
            conflicted_weight=round(float(alignment["conflicted_weight"]), 4),
        )

    def _to_verdict(self, score: float) -> CompositeVerdict:
        if score >= self._bullish_threshold:
            return CompositeVerdict.BULLISH
        if score <= self._bearish_threshold:
            return CompositeVerdict.BEARISH
        return CompositeVerdict.NEUTRAL

    @staticmethod
    def _clamp(value: float, lower: float, upper: float) -> float:
        return max(lower, min(upper, value))

    @staticmethod
    def _layer_direction(score: float) -> CompositeVerdict:
        # Signal Math Contract: directional sign on the -1..+1 scale (neutral at 0).
        sign = directional_sign(score)
        if sign > 0:
            return CompositeVerdict.BULLISH
        if sign < 0:
            return CompositeVerdict.BEARISH
        return CompositeVerdict.NEUTRAL

    def _alignment_meta(
        self,
        signals: list[LayerSignal],
        verdict: CompositeVerdict,
        regime: str,
        layer_effective_weights: dict[str, float],
    ) -> dict[str, object]:
        if verdict == CompositeVerdict.NEUTRAL:
            return self._neutral_plurality_alignment(signals, layer_effective_weights)
        aligned_weight = 0.0
        conflicted_weight = 0.0
        conflicted_layers: list[str] = []
        for signal in signals:
            layer_verdict = self._layer_direction(float(signal.score))
            if layer_verdict == CompositeVerdict.NEUTRAL:
                continue
            layer_weight = layer_effective_weights.get(signal.layer, 0.0)
            if layer_verdict == verdict:
                aligned_weight += layer_weight
            else:
                conflicted_weight += layer_weight
                conflicted_layers.append(signal.layer)
        total_weight = aligned_weight + conflicted_weight
        if total_weight <= 0:
            return {"ratio": 1.0, "conflicted_layers": [], "aligned_weight": 0.0, "conflicted_weight": 0.0}
        return {
            "ratio": aligned_weight / total_weight,
            "conflicted_layers": conflicted_layers,
            "aligned_weight": aligned_weight,
            "conflicted_weight": conflicted_weight,
        }

    def _neutral_plurality_alignment(
        self, signals: list[LayerSignal], layer_effective_weights: dict[str, float]
    ) -> dict[str, object]:
        """When the net score is neutral, measure agreement as the strongest directional bucket share (weighted).

        Uses the same per-layer effective weights computed in :meth:`compute`
        (base × regime × confidence × sensitivity) so neutral-state alignment
        reflects per-symbol News/Geo sensitivity exactly like the directional path.
        """
        bull_w = bear_w = neutral_w = 0.0
        bull_layers: list[str] = []
        bear_layers: list[str] = []
        neutral_layers: list[str] = []
        for signal in signals:
            w = layer_effective_weights.get(signal.layer, 0.0)
            layer_dir = self._layer_direction(float(signal.score))
            if layer_dir == CompositeVerdict.BULLISH:
                bull_w += w
                bull_layers.append(signal.layer)
            elif layer_dir == CompositeVerdict.BEARISH:
                bear_w += w
                bear_layers.append(signal.layer)
            else:
                neutral_w += w
                neutral_layers.append(signal.layer)
        total = bull_w + bear_w + neutral_w
        if total <= 0:
            return {"ratio": 1.0, "conflicted_layers": [], "aligned_weight": 0.0, "conflicted_weight": 0.0}

        best = max(bull_w, bear_w, neutral_w)
        if bull_w == best:
            conflicted_layers = bear_layers + neutral_layers
        elif bear_w == best:
            conflicted_layers = bull_layers + neutral_layers
        else:
            conflicted_layers = bull_layers + bear_layers

        ratio = best / total
        aligned_weight = best
        conflicted_weight = total - best
        return {
            "ratio": ratio,
            "conflicted_layers": conflicted_layers,
            "aligned_weight": aligned_weight,
            "conflicted_weight": conflicted_weight,
        }

    @staticmethod
    def _apply_contradiction_penalty(score: float, alignment_ratio: float) -> float:
        if alignment_ratio < 0.5:
            return score * 0.4
        if alignment_ratio < 0.67:
            return score * 0.65
        if alignment_ratio < 0.85:
            return score * 0.85
        return score


def resolve_composite_block(params: object, mode: str | None = None) -> object:
    """Pick the active :class:`CompositeParameters` block for a given engine mode.

    Single source of truth for mode-aware composite parameter resolution
    (B30 Phase 3 — Suggestion 4 audit). The resolver lets the swing and day
    engines diverge their layer blend weights *without* duplicating the rest of
    the parameter graph (technical / news / macro / sector inputs are still
    shared — only the **composite blend** can be overridden per mode).

    Resolution order:

    * If ``mode == "swing"`` and ``params.swing_composite`` is set, return it.
    * If ``mode == "day"`` and ``params.day_composite`` is set, return it.
    * Otherwise fall back to ``params.composite`` (the shared / legacy block).

    The fallback is the load-bearing invariant: when Secrets Manager JSON does
    not declare per-mode override blocks (which is the case for every existing
    secret today), this resolver returns the shared block → production behavior
    is unchanged. Operators rotate weights per mode by adding ``swing_composite``
    and/or ``day_composite`` keys to the secret payload.

    ``params`` is typed as ``object`` to avoid a circular import; the contract
    is duck-typed: ``params`` must expose a ``composite`` attribute and may
    optionally expose ``swing_composite`` / ``day_composite`` attributes (each
    either a :class:`CompositeParameters` or ``None``).
    """
    if mode == "swing":
        per_mode = getattr(params, "swing_composite", None)
        if per_mode is not None:
            return per_mode
    elif mode == "day":
        per_mode = getattr(params, "day_composite", None)
        if per_mode is not None:
            return per_mode
    return params.composite  # type: ignore[attr-defined]


def build_composite_score_engine_from_params(
    params: object, *, mode: str | None = None
) -> CompositeScoreEngine:
    """Build a :class:`CompositeScoreEngine` from active :class:`SignalParameters`.

    Single source of truth for translating tunable :class:`SignalParameters` into a
    live :class:`CompositeScoreEngine`. All production callsites (swing composite,
    day-trade real composite, and the legacy client-supplied-scores swing handler)
    route through this helper so the ``parameter_version`` stamped on every
    recorded :class:`SignalRecord` actually reflects the weights the engine used.

    ``mode`` selects between the per-mode composite override blocks (``"swing"``
    / ``"day"``) or the shared block (default / ``None``). See
    :func:`resolve_composite_block` for the resolution rules. ``mode=None`` is
    the back-compat path used by tests and any caller that does not need
    per-mode rotation.

    ``params`` is typed as ``object`` to avoid a circular import between
    ``stocvest.signals.composite_score`` and ``stocvest.config.signal_parameters``
    (the latter is import-light, but composite_score is imported by many engines
    that pre-date the config module). The contract is duck-typed: the resolved
    composite block must expose ``technical_weight``, ``news_weight``,
    ``macro_weight``, ``sector_weight``, ``geopolitical_weight``,
    ``internals_weight``, ``bullish_threshold``, and ``bearish_threshold``
    numeric fields — i.e. a
    :class:`stocvest.config.signal_parameters.CompositeParameters`.

    Test code is free to keep instantiating ``CompositeScoreEngine()`` with no
    args for engine-unit coverage; that path falls back to
    :data:`DEFAULT_BASE_WEIGHTS` which is documented as the test/no-args default.
    """
    composite = resolve_composite_block(params, mode)
    base_weights: dict[str, float] = {
        "technical": float(composite.technical_weight),  # type: ignore[attr-defined]
        "news": float(composite.news_weight),  # type: ignore[attr-defined]
        "macro": float(composite.macro_weight),  # type: ignore[attr-defined]
        "sector": float(composite.sector_weight),  # type: ignore[attr-defined]
        "geopolitical": float(composite.geopolitical_weight),  # type: ignore[attr-defined]
        "internals": float(composite.internals_weight),  # type: ignore[attr-defined]
    }
    return CompositeScoreEngine(
        base_weights=base_weights,
        bullish_threshold=float(composite.bullish_threshold),  # type: ignore[attr-defined]
        bearish_threshold=float(composite.bearish_threshold),  # type: ignore[attr-defined]
    )
