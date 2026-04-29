"""
Phase 2d: Signal weighting and composite score.

Combines per-layer directional signals into a single normalized score and
portfolio-level verdict.
"""

from __future__ import annotations

from dataclasses import dataclass
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
            )

        multipliers = self._regime_weights.get(regime, self._regime_weights["sideways"])

        contributions: list[LayerContribution] = []
        weighted_sum = 0.0
        total_effective_weight = 0.0
        confidence_sum = 0.0
        total_confidence_weight = 0.0

        for signal in signals:
            score = self._clamp(signal.score, -1.0, 1.0)
            confidence = self._clamp(signal.confidence, 0.0, 1.0)
            base_weight = self._base_weights.get(signal.layer, 0.0)
            regime_multiplier = multipliers.get(signal.layer, 1.0)

            effective_weight = base_weight * regime_multiplier * confidence
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

        verdict = self._to_verdict(final_score)
        return CompositeSignal(
            score=round(final_score, 4),
            confidence=round(final_confidence, 4),
            verdict=verdict,
            contributions=contributions,
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
