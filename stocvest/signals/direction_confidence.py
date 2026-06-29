"""Direction confidence (B79) — how much to trust the bullish/bearish *direction*.

Pure, testable presentation layer over the composite engine. This does **not** change any
signal math: it reads three already-computed properties of a ``CompositeSignal`` and folds them
into a single High / Moderate / Low read so the UI can say *"Bullish, but only Low confidence"*
instead of implying every verdict is equally trustworthy.

The three inputs (all already on ``CompositeSignal``):

    conviction    = |score|            — how far past the neutral band the blend sits.
    agreement     = alignment_ratio    — share of effective weight that backs the verdict.
    data_quality  = confidence         — weighted average of per-layer confidence (data sufficiency).

Tiering is gate-based (every dimension must clear its bar) so it is explainable, not a black-box
blend. A neutral verdict has no direction to be confident about, so it always reports ``Low``.

Keep the literals in sync with ``frontend/lib/signal-evidence/direction-confidence.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Tier = Literal["High", "Moderate", "Low"]

# Per-dimension bars. A tier is the *weakest* dimension's bar that all three still clear.
#   High     — strong conviction, strong agreement, solid data.
#   Moderate — a real directional read, but one dimension is soft.
#   Low      — near the neutral band, layers disagree, or data is thin -> treat as fragile.
_HIGH = {"conviction": 0.35, "agreement": 0.67, "data_quality": 0.60}
_MODERATE = {"conviction": 0.20, "agreement": 0.50, "data_quality": 0.40}

# Blended 0..100 score for tooltips only (NOT used for tiering). Conviction is scaled against 0.5
# because composite |score| rarely approaches 1.0 in practice.
_W_CONVICTION = 0.5
_W_AGREEMENT = 0.3
_W_DATA = 0.2
_CONVICTION_FULL_SCALE = 0.5


@dataclass(frozen=True)
class DirectionConfidence:
    tier: Tier
    score: int  # 0..100, display/tooltip only
    reason: str  # short, human, names the limiting factor


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def assess_direction_confidence(
    *,
    score: float,
    confidence: float,
    alignment_ratio: float,
    is_neutral: bool,
) -> DirectionConfidence:
    """Fold conviction/agreement/data-quality into a High/Moderate/Low direction read."""
    conviction = abs(float(score))
    agreement = _clamp01(float(alignment_ratio))
    data_quality = _clamp01(float(confidence))

    blended = int(
        round(
            100.0
            * (
                _W_CONVICTION * _clamp01(conviction / _CONVICTION_FULL_SCALE)
                + _W_AGREEMENT * agreement
                + _W_DATA * data_quality
            )
        )
    )

    # No direction => nothing to be confident about.
    if is_neutral:
        return DirectionConfidence(
            tier="Low",
            score=blended,
            reason="Composite is neutral — no directional edge to trust yet.",
        )

    dims = {"conviction": conviction, "agreement": agreement, "data_quality": data_quality}

    if all(dims[k] >= _HIGH[k] for k in _HIGH):
        return DirectionConfidence(
            tier="High",
            score=blended,
            reason="Strong, well-aligned read with sufficient data.",
        )

    if all(dims[k] >= _MODERATE[k] for k in _MODERATE):
        return DirectionConfidence(
            tier="Moderate",
            score=blended,
            reason=_limiting_reason(dims, _HIGH),
        )

    return DirectionConfidence(
        tier="Low",
        score=blended,
        reason=_limiting_reason(dims, _MODERATE),
    )


def _limiting_reason(dims: dict[str, float], bars: dict[str, float]) -> str:
    """Name the dimension that fell furthest short of the next tier's bar."""
    # Largest shortfall (bar - value) wins; ties resolve conviction -> agreement -> data_quality.
    order = ("conviction", "agreement", "data_quality")
    worst = max(order, key=lambda k: bars[k] - dims[k])
    if bars[worst] - dims[worst] <= 0:
        # All clear the bar but a stricter (High) gate failed elsewhere; generic message.
        return "Directional read is solid but not fully confirmed across all dimensions."
    if worst == "conviction":
        return "Score sits close to the neutral band — the directional edge is thin."
    if worst == "agreement":
        return "Layers disagree — a meaningful share of the weight opposes the verdict."
    return "Underlying layer data is thin or low-confidence."
