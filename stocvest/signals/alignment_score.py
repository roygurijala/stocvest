"""
Cross-layer synthesis: Macro-Sector-Stock alignment modifier on the composite score.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict


class AlignmentLevel(str, Enum):
    FULL = "full"
    STRONG = "strong"
    MODERATE = "moderate"
    WEAK = "weak"
    CONFLICT = "conflict"


@dataclass
class AlignmentResult:
    level: AlignmentLevel
    score_modifier: float
    macro_supports: bool
    sector_supports: bool
    technical_supports: bool
    macro_direction: str
    sector_direction: str
    technical_direction: str
    is_tailwind: bool
    is_headwind: bool
    is_counter_trend: bool
    alignment_label: str
    alignment_detail: str
    alignment_chip: str


def _normalize_regime(macro_regime: str) -> str:
    m = (macro_regime or "").strip().lower()
    if m in ("bullish", "risk_on", "bull"):
        return "bullish"
    if m in ("bearish", "risk_off", "avoid"):
        return "bearish"
    return m


def _supports(verdict: str, direction: str) -> bool:
    v = (verdict or "").strip().lower()
    if direction == "long":
        return v == "bullish"
    if direction == "short":
        return v == "bearish"
    return False


def _opposes(verdict: str, direction: str) -> bool:
    v = (verdict or "").strip().lower()
    if direction == "long":
        return v == "bearish"
    if direction == "short":
        return v == "bullish"
    return False


def compute_alignment_score(
    macro_verdict: str,
    macro_regime: str,
    sector_verdict: str,
    sector_persistence: float,
    technical_verdict: str,
    signal_direction: str,
) -> AlignmentResult:
    nr = _normalize_regime(macro_regime)
    effective_macro = nr if nr in ("bullish", "bearish") else (macro_verdict or "neutral").strip().lower()

    mac_supports = _supports(effective_macro, signal_direction)
    mac_opposes = _opposes(effective_macro, signal_direction)
    sec_supports = _supports(sector_verdict, signal_direction)
    sec_opposes = _opposes(sector_verdict, signal_direction)
    tec_supports = _supports(technical_verdict, signal_direction)
    tec_opposes = _opposes(technical_verdict, signal_direction)

    support_count = sum([mac_supports, sec_supports, tec_supports])
    oppose_count = sum([mac_opposes, sec_opposes, tec_opposes])

    if support_count == 3:
        persistence_bonus = (
            2.0 if sector_persistence >= 0.8 else 1.0 if sector_persistence >= 0.6 else 0.0
        )
        modifier = 12.0 + persistence_bonus
        return AlignmentResult(
            level=AlignmentLevel.FULL,
            score_modifier=round(modifier, 1),
            macro_supports=True,
            sector_supports=True,
            technical_supports=True,
            macro_direction=effective_macro,
            sector_direction=(sector_verdict or "neutral").strip().lower(),
            technical_direction=(technical_verdict or "neutral").strip().lower(),
            is_tailwind=True,
            is_headwind=False,
            is_counter_trend=False,
            alignment_label="Full alignment",
            alignment_detail=(
                "Macro regime, sector leadership, and technical setup all confirm this direction. "
                "Highest conviction swing setup."
            ),
            alignment_chip="All layers aligned ✓",
        )

    if mac_supports and sec_supports and not tec_opposes:
        return AlignmentResult(
            level=AlignmentLevel.STRONG,
            score_modifier=8.0,
            macro_supports=True,
            sector_supports=True,
            technical_supports=tec_supports,
            macro_direction=effective_macro,
            sector_direction=(sector_verdict or "neutral").strip().lower(),
            technical_direction=(technical_verdict or "neutral").strip().lower(),
            is_tailwind=True,
            is_headwind=False,
            is_counter_trend=False,
            alignment_label="Macro-sector tailwind",
            alignment_detail=(
                "Market regime and sector leadership both support this direction. "
                "Technical setup adds confirmation."
            ),
            alignment_chip="Macro + sector aligned",
        )

    if mac_opposes:
        return AlignmentResult(
            level=AlignmentLevel.CONFLICT,
            score_modifier=-12.0,
            macro_supports=False,
            sector_supports=sec_supports,
            technical_supports=tec_supports,
            macro_direction=effective_macro,
            sector_direction=(sector_verdict or "neutral").strip().lower(),
            technical_direction=(technical_verdict or "neutral").strip().lower(),
            is_tailwind=False,
            is_headwind=True,
            is_counter_trend=True,
            alignment_label="Macro headwind",
            alignment_detail=(
                "Market regime opposes this trade direction. Counter-trend setup requires strict risk "
                "management and reduced position size."
            ),
            alignment_chip="⚠️ Macro headwind",
        )

    if sec_opposes and sector_persistence <= 0.4:
        return AlignmentResult(
            level=AlignmentLevel.CONFLICT,
            score_modifier=-8.0,
            macro_supports=mac_supports,
            sector_supports=False,
            technical_supports=tec_supports,
            macro_direction=effective_macro,
            sector_direction=(sector_verdict or "neutral").strip().lower(),
            technical_direction=(technical_verdict or "neutral").strip().lower(),
            is_tailwind=False,
            is_headwind=True,
            is_counter_trend=False,
            alignment_label="Sector headwind",
            alignment_detail=(
                "This stock's sector is persistently lagging the market. Higher failure rate "
                "for swing setups against sector trend."
            ),
            alignment_chip="⚠️ Sector headwind",
        )

    if support_count == 2 and oppose_count == 0:
        if mac_supports and sec_supports:
            chip = "Macro + sector aligned"
        elif mac_supports and tec_supports:
            chip = "Macro + technical aligned"
        else:
            chip = "Sector + technical aligned"
        return AlignmentResult(
            level=AlignmentLevel.MODERATE,
            score_modifier=4.0,
            macro_supports=mac_supports,
            sector_supports=sec_supports,
            technical_supports=tec_supports,
            macro_direction=effective_macro,
            sector_direction=(sector_verdict or "neutral").strip().lower(),
            technical_direction=(technical_verdict or "neutral").strip().lower(),
            is_tailwind=False,
            is_headwind=False,
            is_counter_trend=False,
            alignment_label="Moderate alignment",
            alignment_detail=(
                "Two of three layers confirm direction. One layer is neutral. Wait for full "
                "confirmation before maximum sizing."
            ),
            alignment_chip=chip,
        )

    return AlignmentResult(
        level=AlignmentLevel.WEAK,
        score_modifier=-2.0,
        macro_supports=mac_supports,
        sector_supports=sec_supports,
        technical_supports=tec_supports,
        macro_direction=effective_macro,
        sector_direction=(sector_verdict or "neutral").strip().lower(),
        technical_direction=(technical_verdict or "neutral").strip().lower(),
        is_tailwind=False,
        is_headwind=False,
        is_counter_trend=False,
        alignment_label="Mixed alignment",
        alignment_detail=(
            "Signal layers are mixed. Entry exists but lacks broad confirmation. Consider "
            "waiting for additional alignment."
        ),
        alignment_chip="Mixed signals",
    )


def apply_alignment_modifier(raw_composite: float, alignment: AlignmentResult) -> float:
    modified = raw_composite + alignment.score_modifier
    return round(max(0.0, min(100.0, modified)), 1)


def adjust_composite_with_alignment(
    composite: CompositeSignal,
    *,
    macro_verdict: str,
    macro_regime: str,
    sector_verdict: str,
    sector_persistence: float,
    technical_verdict: str,
    bullish_threshold: float,
    bearish_threshold: float,
) -> tuple[CompositeSignal, AlignmentResult]:
    """Map composite.score (-1..1) to 0..100, apply alignment, map back and re-derive verdict."""
    from dataclasses import replace

    signal_direction = (
        "long"
        if composite.verdict == CompositeVerdict.BULLISH
        else "short"
        if composite.verdict == CompositeVerdict.BEARISH
        else "long"
    )
    raw_100 = (float(composite.score) + 1.0) * 50.0
    alignment = compute_alignment_score(
        macro_verdict=macro_verdict,
        macro_regime=macro_regime,
        sector_verdict=sector_verdict,
        sector_persistence=sector_persistence,
        technical_verdict=technical_verdict,
        signal_direction=signal_direction,
    )
    final_100 = apply_alignment_modifier(raw_100, alignment)
    adj = final_100 / 50.0 - 1.0
    adj = max(-1.0, min(1.0, round(adj, 4)))
    if adj >= bullish_threshold:
        nv = CompositeVerdict.BULLISH
    elif adj <= bearish_threshold:
        nv = CompositeVerdict.BEARISH
    else:
        nv = CompositeVerdict.NEUTRAL
    return replace(composite, score=adj, verdict=nv), alignment


def alignment_to_response_dict(alignment: AlignmentResult) -> dict:
    return {
        "level": alignment.level.value,
        "score_modifier": alignment.score_modifier,
        "label": alignment.alignment_label,
        "detail": alignment.alignment_detail,
        "chip": alignment.alignment_chip,
        "is_tailwind": alignment.is_tailwind,
        "is_headwind": alignment.is_headwind,
        "is_counter_trend": alignment.is_counter_trend,
        "macro_direction": alignment.macro_direction,
        "sector_direction": alignment.sector_direction,
        "technical_direction": alignment.technical_direction,
        "macro_supports": alignment.macro_supports,
        "sector_supports": alignment.sector_supports,
        "technical_supports": alignment.technical_supports,
    }
