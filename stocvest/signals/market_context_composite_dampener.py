"""
Post-composite dampening when IPO / index-inclusion context distorts sector and internals reads.

Uses Option B normalization: effective weights shrink and the composite is recomputed over the
remaining weight — lower total conviction, no redistribution to other layers.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from stocvest.signals.composite_score import (
    CompositeSignal,
    CompositeVerdict,
    LayerContribution,
)


def technical_multiplier_for_listed_days(listed_days: int | None) -> float | None:
    """Tier technical reliability by listing age (<90 sessions)."""
    if listed_days is None:
        return None
    if listed_days < 10:
        return 0.30
    if listed_days < 30:
        return 0.50
    if listed_days < 60:
        return 0.65
    if listed_days < 90:
        return 0.80
    return None


def _layer_dampening_multipliers(flags: dict[str, Any]) -> dict[str, float]:
    """Layer name → retention multiplier in (0, 1]; omitted layers stay at 1.0."""
    mult: dict[str, float] = {}
    role = str(flags.get("ecosystem_role") or "")

    if flags.get("index_inclusion_window"):
        if role in {"corporate_backer", "etf_or_cef_holder"}:
            mult["sector"] = min(mult.get("sector", 1.0), 0.70)
            mult["internals"] = min(mult.get("internals", 1.0), 0.70)
        else:
            mult["sector"] = min(mult.get("sector", 1.0), 0.55)
            mult["internals"] = min(mult.get("internals", 1.0), 0.55)

    if flags.get("ipo_unseasoned"):
        listed_days = flags.get("listed_days")
        days_i = listed_days if isinstance(listed_days, int) else None
        tech = technical_multiplier_for_listed_days(days_i)
        if tech is not None:
            mult["technical"] = min(mult.get("technical", 1.0), tech)
        mult["sector"] = min(mult.get("sector", 1.0), 0.55)
        mult["internals"] = min(mult.get("internals", 1.0), 0.55)

    return mult


def _dampening_reason(flags: dict[str, Any]) -> str:
    if flags.get("index_inclusion_window") and flags.get("ipo_unseasoned"):
        return "index_inclusion_and_unseasoned"
    if flags.get("index_inclusion_window"):
        return "index_inclusion_window"
    if flags.get("ipo_unseasoned"):
        return "ipo_unseasoned"
    return "market_context"


def _score_to_display_100(score: float) -> int:
    return max(0, min(100, int(round((float(score) + 1.0) * 50.0))))


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
    Scale distorted layers when IPO / index-inclusion flags are active.

    Returns adjusted composite and ``market_context_dampening`` metadata for the API.
    """
    if not flags:
        return composite, None

    mult = _layer_dampening_multipliers(flags)
    if not mult:
        return composite, None

    undampened_score = _score_to_display_100(composite.score)
    layer_details: list[dict[str, Any]] = []
    new_contribs: list[LayerContribution] = []

    for c in composite.contributions:
        factor = mult.get(c.layer, 1.0)
        if factor >= 0.999:
            new_contribs.append(c)
            continue
        eff = c.effective_weight * factor
        adjusted = LayerContribution(
            layer=c.layer,
            raw_score=c.raw_score,
            confidence=c.confidence,
            base_weight=c.base_weight,
            regime_multiplier=c.regime_multiplier,
            effective_weight=round(eff, 6),
            weighted_value=round(c.raw_score * eff, 6),
        )
        new_contribs.append(adjusted)
        layer_details.append(
            {
                "layer": c.layer,
                "multiplier": round(factor, 4),
                "original_contribution": round(c.weighted_value, 6),
                "adjusted_contribution": round(adjusted.weighted_value, 6),
            }
        )

    score, verdict = _recompute_score(
        new_contribs,
        bullish_threshold=bullish_threshold,
        bearish_threshold=bearish_threshold,
    )
    adjusted_score = _score_to_display_100(score)

    meta: dict[str, Any] = {
        "active": True,
        "reason": _dampening_reason(flags),
        "trigger": flags.get("ecosystem_entity"),
        "window_end": flags.get("index_inclusion_window_end"),
        "confidence_level": "reduced",
        "undampened_score": undampened_score,
        "adjusted_score": adjusted_score,
        "dampened_layers": layer_details,
        # Back-compat flat list for older UI paths
        "layer_multipliers": {d["layer"]: d["multiplier"] for d in layer_details},
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
