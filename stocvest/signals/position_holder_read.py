"""Position holder / position-management read (ship-dark; default OFF).

Owner-oriented read for the Long Term desk: guidance for a user who ALREADY HOLDS the
name ("should I stay in / trim / protect?"), as opposed to the entry-oriented screening the
rest of the desk provides. It is **deterministic** — every line maps to a signal the engine
already computed (structure-broken flag, risk/reward vs the desk minimum, reference stop
distance). It invents no thresholds and no numbers.

IMPORTANT: this intentionally uses management-action language ("tighten your stop",
"reduce", "add") that the standard Position copy guard bans. It is gated behind
``stocvest_position_holder_read_enabled`` (OFF by default) and MUST NOT be enabled in
production until legal/compliance signs off on holder-oriented guidance.
"""

from __future__ import annotations

from typing import Any

_HOLDER_DISCLAIMER = (
    "Informational position context for an existing holder — not personalized "
    "investment advice. Signal data only."
)


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _context_lines(body: dict[str, Any]) -> list[str]:
    """Factual (non-judgmental) context the holder should weigh — no invented thresholds."""
    lines: list[str] = []
    rr = _num(body.get("risk_reward"))
    min_rr = _num(body.get("min_rr_desk"))
    if rr is not None and min_rr is not None:
        lines.append(
            f"Reward-to-risk is {rr:.2f} vs the desk minimum of {min_rr:.2f} at this price."
        )
    stop_atr = _num(body.get("reference_stop_distance_atr"))
    stop_level = _num(body.get("reference_stop_level"))
    if stop_atr is not None and stop_level is not None:
        lines.append(f"Reference stop sits {stop_atr:.1f}×ATR away, near {stop_level:g}.")
    return lines


def build_position_holder_read(body: dict[str, Any] | None) -> dict[str, Any] | None:
    """Build the owner-oriented read from an already-computed position composite body.

    Returns ``None`` when there is nothing to advise on (insufficient data / no verdict),
    so the caller simply omits the field.
    """
    if not isinstance(body, dict):
        return None
    status = str(body.get("status") or "").strip().lower()
    # Only bail on a truly unreadable composite. "incomplete" (geometry couldn't form a clean
    # tradeable entry) is common — and highly relevant — for someone who already owns the name.
    if status == "insufficient_data":
        return None
    verdict = str(body.get("signal_summary") or body.get("verdict") or "").strip().lower()
    if not verdict:
        return None

    structure_broken = body.get("signal_structure_broken") is True
    rr = _num(body.get("risk_reward"))
    min_rr = _num(body.get("min_rr_desk"))
    rr_unfavorable = rr is not None and min_rr is not None and rr < min_rr
    fund_verdict = str(
        (body.get("position_fundamentals") or {}).get("verdict") or ""
    ).strip().lower()

    context = _context_lines(body)

    if structure_broken and rr_unfavorable:
        stance = "defensive"
        headline = "Structure has broken and reward-to-risk is unfavorable at this price."
        actions = [
            "Tighten your stop toward the weekly trend (reference stop) to protect capital.",
            "Consider reducing exposure while the weekly trend stays broken.",
            "Reassess for fresh size only once price stabilizes back above the weekly trend.",
        ]
        if fund_verdict == "bullish":
            context.append(
                "Fundamentals still read bullish — this is a quality-vs-price-structure "
                "conflict: decide whether you are holding for the multi-year thesis or "
                "protecting capital on the broken trend."
            )
    elif structure_broken:
        stance = "caution"
        headline = "Weekly structure has broken, even though geometry isn't outright blocked."
        actions = [
            "Tighten your stop toward the weekly trend (reference stop).",
            "Hold only if you are committed to the multi-year thesis; otherwise protect capital.",
        ]
    elif rr_unfavorable:
        stance = "caution"
        headline = "Trend is intact but reward-to-risk is thin at this price."
        actions = [
            "Avoid adding size here — the risk/reward does not favor new exposure.",
            "Keep your stop at the reference level and let the position work.",
        ]
    else:
        stance = "constructive"
        headline = "Structure is intact and the desk read is supportive."
        actions = [
            "No defensive action indicated — hold with your existing plan.",
            "Add only on constructive pullbacks that keep reward-to-risk favorable.",
        ]

    return {
        "stance": stance,
        "headline": headline,
        "actions": actions,
        "context": context,
        "disclaimer": _HOLDER_DISCLAIMER,
    }
