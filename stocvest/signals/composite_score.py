"""
Phase 2d: Signal weighting and composite score.

Combines per-layer directional signals into a single normalized score and
portfolio-level verdict.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


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
DEFAULT_BASE_WEIGHTS: dict[str, float] = {
    "technical": 0.30,
    "news": 0.18,
    "sector": 0.12,
    "macro": 0.16,
    "geopolitical": 0.12,
    "internals": 0.12,
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
        bullish_threshold: float = 0.20,
        bearish_threshold: float = -0.20,
    ) -> None:
        self._base_weights = dict(base_weights or DEFAULT_BASE_WEIGHTS)
        self._regime_weights = dict(regime_weights or REGIME_WEIGHTS)
        self._bullish_threshold = bullish_threshold
        self._bearish_threshold = bearish_threshold

    def compute(self, signals: list[LayerSignal], regime: str = "sideways") -> CompositeSignal:
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

        contributions: list[LayerContribution] = []
        weighted_sum = 0.0
        total_effective_weight = 0.0
        confidence_sum = 0.0
        total_confidence_weight = 0.0
        layer_effective_weights: dict[str, float] = {}

        for signal in signals:
            score = self._clamp(signal.score, -1.0, 1.0)
            confidence = self._clamp(signal.confidence, 0.0, 1.0)
            base_weight = self._base_weights.get(signal.layer, 0.0)
            regime_multiplier = multipliers.get(signal.layer, 1.0)

            effective_weight = base_weight * regime_multiplier * confidence
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
            final_score = self._clamp(weighted_sum / total_effective_weight, -1.0, 1.0)

        if total_confidence_weight == 0:
            final_confidence = 0.0
        else:
            final_confidence = self._clamp(confidence_sum / total_confidence_weight, 0.0, 1.0)

        raw_verdict = self._to_verdict(final_score)
        alignment = self._alignment_meta(signals, raw_verdict, regime, layer_effective_weights)
        final_score = self._apply_contradiction_penalty(final_score, alignment["ratio"])
        verdict = self._to_verdict(final_score)
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
        if score > 0:
            return CompositeVerdict.BULLISH
        if score < 0:
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
            return self._neutral_plurality_alignment(signals, regime)
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

    def _neutral_plurality_alignment(self, signals: list[LayerSignal], regime: str) -> dict[str, object]:
        """When the net score is neutral, measure agreement as the strongest directional bucket share (weighted)."""
        multipliers = self._regime_weights.get(regime, self._regime_weights["sideways"])
        bull_w = bear_w = neutral_w = 0.0
        bull_layers: list[str] = []
        bear_layers: list[str] = []
        neutral_layers: list[str] = []
        for signal in signals:
            w = (
                self._base_weights.get(signal.layer, 0.0)
                * multipliers.get(signal.layer, 1.0)
                * self._clamp(signal.confidence, 0.0, 1.0)
            )
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
