"""
Post-composite dampening when IPO / index-inclusion context distorts sector and internals reads.

Degradation only — does not block composite eligibility. Complements advisory ``market_context_flags``.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from stocvest.signals.composite_score import (
    CompositeSignal,
    CompositeVerdict,
    LayerContribution,
)


def _layer_dampening_multipliers(flags: dict[str, Any]) -> dict[str, float]:
    """Layer name → multiplier in (0, 1]; omitted layers stay at 1.0."""
    mult: dict[str, float] = {}
    if flags.get("index_inclusion_window"):
        mult["sector"] = min(mult.get("sector", 1.0), 0.55)
        mult["internals"] = min(mult.get("internals", 1.0), 0.55)

    if flags.get("ipo_unseasoned"):
        mult["technical"] = min(mult.get("technical", 1.0), 0.65)
        mult["sector"] = min(mult.get("sector", 1.0), 0.55)
        mult["internals"] = min(mult.get("internals", 1.0), 0.55)

    warnings = flags.get("warnings")
    warn_text = " ".join(str(w) for w in warnings).lower() if isinstance(warnings, list) else ""
    role = str(flags.get("ecosystem_role") or "")
    if role in {"corporate_backer", "etf_or_cef_holder"} and (
        "roadshow" in warn_text or "index inclusion" in warn_text
    ):
        mult["sector"] = min(mult.get("sector", 1.0), 0.70)
        mult["internals"] = min(mult.get("internals", 1.0), 0.70)

    return mult


def _recompute_score(
    contributions: list[LayerContribution],
    *,
    bullish_threshold: float,
    bearish_threshold: float,
) -> tuple[float, CompositeVerdict]:
    weighted_sum = sum(c.weighted_value for c in contributions)
    total_w = sum(c.effective_weight for c in contributions)
    if total_w <= 0:
        score = 0.0
    else:
        score = max(-1.0, min(1.0, weighted_sum / total_w))
    if score >= bullish_threshold:
        verdict = CompositeVerdict.BULLISH
    elif score <= bearish_threshold:
        verdict = CompositeVerdict.BEARISH
    else:
        verdict = CompositeVerdict.NEUTRAL
    return round(score, 4), verdict


def apply_market_context_composite_dampening(
    composite: CompositeSignal,
    flags: dict[str, Any] | None,
    *,
    bullish_threshold: float,
    bearish_threshold: float,
) -> tuple[CompositeSignal, dict[str, Any] | None]:
    """
    Scale sector/internals (and technical on unseasoned listings) when mechanical flows dominate.

    Returns adjusted composite and optional ``market_context_dampening`` metadata for the API.
    """
    if not flags:
        return composite, None

    mult = _layer_dampening_multipliers(flags)
    if not mult:
        return composite, None

    new_contribs: list[LayerContribution] = []
    for c in composite.contributions:
        factor = mult.get(c.layer, 1.0)
        if factor >= 0.999:
            new_contribs.append(c)
            continue
        eff = c.effective_weight * factor
        new_contribs.append(
            LayerContribution(
                layer=c.layer,
                raw_score=c.raw_score,
                confidence=c.confidence,
                base_weight=c.base_weight,
                regime_multiplier=c.regime_multiplier,
                effective_weight=round(eff, 6),
                weighted_value=round(c.raw_score * eff, 6),
            )
        )

    score, verdict = _recompute_score(
        new_contribs,
        bullish_threshold=bullish_threshold,
        bearish_threshold=bearish_threshold,
    )
    dampened_layers = sorted(mult.keys())
    meta = {
        "dampened_layers": dampened_layers,
        "layer_multipliers": {k: mult[k] for k in dampened_layers},
        "reason": "IPO or index-inclusion context — sector/internals may reflect mechanical flows",
    }
    return (
        replace(
            composite,
            score=score,
            verdict=verdict,
            contributions=new_contribs,
        ),
        meta,
    )
