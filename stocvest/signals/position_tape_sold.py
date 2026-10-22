"""Quality names sold off with a hostile tape — observational, not a bounce forecast.

Composes fields the Position desk already computes (session SPY/QQQ/VIX label,
G5 breakdown band, near-52w-high band, hygiene, F2/G1, news/geo). No new numeric
floors.

The long-horizon ``regime`` field is neutralized on this desk (today's index
move is treated as noise for a multi-year hold). This strip reads the session
tape the macro layer already labels — the same ``infer_regime`` chip used on
swing/day — so a same-day Nasdaq dump is visible.

Shown on Invest when that session label is bearish, or when the long-horizon
regime is already avoid/risk_off. Empty in a calm tape.
"""

from __future__ import annotations

from stocvest.signals.position_gem_gates import (
    CandidateFeatures,
    SHARP_BREAKDOWN_PCT_FROM_HIGH,
    _AVOID_REGIMES,
    evaluate_gem_gates,
    is_gem_hygiene,
    is_growth_led,
    is_sharp_breakdown,
)

# Same "near 52-week high" band the position technical analyzer already uses
# (``pct_from_high >= -5`` earns the near-high credit). Off that band = off highs.
NEAR_52W_HIGH_PCT = -5.0

TAPE_SOLD_WHY = (
    "Quality name off its highs while the tape is risk-off — sold with the market, "
    "not a company break. Screening only, not a bounce forecast."
)


def regime_is_hostile(f: CandidateFeatures) -> bool:
    """Session tape (macro ``Label Bearish``) or the long-horizon G7 avoid set."""
    if (f.session_tape or "").strip().lower() == "bearish":
        return True
    return f.regime in _AVOID_REGIMES


def structure_intact(f: CandidateFeatures) -> bool:
    """Weekly structure still standing — not the G5 sharp-breakdown / broken-basis path."""
    if f.structure_broken or is_sharp_breakdown(f):
        return False
    return bool(f.above_sma200) or f.in_base


def quality_holds(f: CandidateFeatures, gates: dict[str, bool]) -> bool:
    """Hygiene plus either F2-led growth or G1-strong fundamentals (mega-caps included)."""
    if not is_gem_hygiene(f, gates):
        return False
    return is_growth_led(f) or bool(gates.get("G1"))


def no_name_specific_break(f: CandidateFeatures) -> bool:
    """News/geo not already calling a company-specific break."""
    return f.news_verdict != "bearish" and f.geo_verdict != "bearish"


def _drawdown_from_high_pct(f: CandidateFeatures) -> float | None:
    """More-off of the weekly 52w read and the session mark vs the same high."""
    pts = [p for p in (f.pct_from_52w_high, f.pct_from_52w_high_session) if p is not None]
    return min(pts) if pts else None


def off_highs_not_broken(f: CandidateFeatures) -> bool:
    """Below the existing near-high band, above the existing G5 sharp-breakdown band."""
    pct = _drawdown_from_high_pct(f)
    if pct is None or pct <= SHARP_BREAKDOWN_PCT_FROM_HIGH:
        return False
    if is_sharp_breakdown(f):
        return False
    return pct < NEAR_52W_HIGH_PCT


def qualifies_tape_sold(
    f: CandidateFeatures,
    gates: dict[str, bool] | None = None,
) -> bool:
    """True when a quality, intact name is off highs in a hostile tape."""
    if f.status == "insufficient_data":
        return False
    g = gates if gates is not None else evaluate_gem_gates(f)
    return (
        regime_is_hostile(f)
        and structure_intact(f)
        and quality_holds(f, g)
        and no_name_specific_break(f)
        and off_highs_not_broken(f)
    )
