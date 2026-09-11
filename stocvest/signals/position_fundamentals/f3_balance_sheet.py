"""F3 — Balance sheet & solvency pillar."""

from __future__ import annotations

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import (
    apply_score_delta,
    finalize_pillar_score,
    latest_as_of,
    pillar_data_quality,
    prioritize_chips,
    unavailable_pillar,
)
from stocvest.signals.position_fundamentals.sector_overrides import SectorOverrideFlags
from stocvest.signals.position_fundamentals.types import (
    PILLAR_LABELS,
    PILLAR_WEIGHTS,
    PositionPillarResult,
)
from stocvest.signals.signal_math_contract import LAYER_SCORE_NEUTRAL


def score_f3_balance_sheet(
    snapshot: PositionFundamentalsSnapshot,
    *,
    sector_flags: SectorOverrideFlags | None = None,
    fundamentals_v2: bool = False,
) -> PositionPillarResult:
    flags = sector_flags or SectorOverrideFlags()
    ratios = snapshot.ratios
    balance = snapshot.balance_sheets
    if not ratios and not balance:
        return unavailable_pillar("F3", reason="Balance sheet inputs unavailable.")

    quality = pillar_data_quality(max(len(ratios), len(balance)))
    base = float(LAYER_SCORE_NEUTRAL)
    chips: list[str] = []
    red_flags: list[str] = []

    suppress_current = fundamentals_v2 and flags.suppress_current_ratio
    latest_ratio = ratios[0] if ratios else None
    if latest_ratio is not None:
        current = latest_ratio.current_ratio
        if current is not None and suppress_current:
            # Banks/insurers have no industrial current-asset/liability structure, so a
            # sub-1.0 current ratio is not a liquidity red flag — surface as context only.
            chips.append(f"Current ratio {current:.1f} — not a solvency metric for this sector")
        elif current is not None:
            if current >= 1.5:
                base = apply_score_delta(base, 8)
                chips.append(f"Current ratio {current:.1f}")
            elif current < 1.0:
                base = apply_score_delta(base, -12)
                chips.append(f"Current ratio {current:.1f} — tight liquidity")

        coverage = latest_ratio.interest_coverage
        if coverage is not None:
            if coverage >= 5.0:
                base = apply_score_delta(base, 12)
                chips.append(f"Interest coverage {coverage:.1f}x")
            elif coverage >= 1.5:
                base = apply_score_delta(base, 4)
                chips.append(f"Interest coverage {coverage:.1f}x")
            else:
                base = apply_score_delta(base, -20)
                red_flags.append("Interest coverage below 1.5x")

        de = latest_ratio.debt_equity_ratio
        if de is not None:
            if flags.structural_high_leverage:
                # Banks/REITs are structurally levered (deposits, mortgage debt); a high D/E
                # is not a solvency red flag here, so it is surfaced as context, not scored.
                chips.append(f"D/E {de:.1f} — structural for sector (not a red flag)")
            elif de <= 0.5:
                base = apply_score_delta(base, 8)
                chips.append(f"D/E {de:.1f} — conservative")
            elif de >= 2.5:
                base = apply_score_delta(base, -12)
                red_flags.append(f"Elevated leverage (D/E {de:.1f})")

    latest_balance = balance[0] if balance else None
    if latest_balance is not None:
        cash = latest_balance.cash_and_equivalents
        st_debt = latest_balance.short_term_debt
        if cash is not None and st_debt is not None and st_debt > 0:
            if cash >= st_debt:
                base = apply_score_delta(base, 6)
                chips.append("Cash covers short-term debt")
            else:
                base = apply_score_delta(base, -8)
                chips.append("Cash below short-term debt")

    chips.extend(red_flags)
    score, verdict = finalize_pillar_score(base)
    if red_flags and verdict == "bullish":
        verdict = "neutral"
        score = min(score, 58)

    reasoning = (
        f"Balance sheet read {score}/100 — "
        + (prioritize_chips(red_flags, chips)[0] if (red_flags or chips) else "mixed solvency signals")
        + ". Signal data only."
    )
    return PositionPillarResult(
        pillar_id="F3",
        label=PILLAR_LABELS["F3"],
        weight=PILLAR_WEIGHTS["F3"],
        status="active",
        score=score,
        verdict=verdict,
        reasoning=reasoning,
        chips=prioritize_chips(red_flags, chips),
        data_quality=quality,
        as_of_date=latest_as_of(ratios or balance),
    )
