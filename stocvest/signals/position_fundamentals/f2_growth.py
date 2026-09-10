"""F2 — Growth pillar."""

from __future__ import annotations

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import (
    apply_score_delta,
    cagr,
    finalize_pillar_score,
    latest_as_of,
    pillar_data_quality,
    quarter_offset_value,
    unavailable_pillar,
    yoy_ratio,
)
from stocvest.signals.position_fundamentals.types import (
    PILLAR_LABELS,
    PILLAR_WEIGHTS,
    PositionPillarResult,
)
from stocvest.signals.signal_math_contract import LAYER_SCORE_NEUTRAL


def _apply_growth_delta(base: float, growth: float | None, *, label: str) -> tuple[float, list[str]]:
    chips: list[str] = []
    if growth is None:
        return base, chips
    pct = growth * 100.0
    if growth >= 0.15:
        base = apply_score_delta(base, 18)
        chips.append(f"{label} +{pct:.0f}% YoY — strong")
    elif growth >= 0.05:
        base = apply_score_delta(base, 10)
        chips.append(f"{label} +{pct:.0f}% YoY")
    elif growth >= 0.0:
        base = apply_score_delta(base, 3)
        chips.append(f"{label} +{pct:.0f}% YoY — modest")
    elif growth >= -0.05:
        base = apply_score_delta(base, -8)
        chips.append(f"{label} {pct:.0f}% YoY — flat/soft")
    else:
        base = apply_score_delta(base, -18)
        chips.append(f"{label} {pct:.0f}% YoY — declining")
    return base, chips


def score_f2_growth(
    snapshot: PositionFundamentalsSnapshot,
    *,
    guidance_direction: str = "unknown",
    revenue_trend: str = "unknown",
) -> PositionPillarResult:
    income = sorted(snapshot.income_statements, key=lambda r: r.as_of_date, reverse=True)
    if len(income) < 2:
        return unavailable_pillar("F2", reason="Need at least two quarters for growth trend.")

    has_yoy = len(income) >= 5
    quality = pillar_data_quality(len(income))
    if not has_yoy and quality == "high":
        quality = "medium"

    base = float(LAYER_SCORE_NEUTRAL)
    chips: list[str] = []

    if has_yoy:
        latest_rev, prior_rev = quarter_offset_value(income, lambda r: r.revenue)
        rev_yoy = yoy_ratio(latest_rev, prior_rev)
        base, rev_chips = _apply_growth_delta(base, rev_yoy, label="Revenue")
        chips.extend(rev_chips)

        latest_eps, prior_eps = quarter_offset_value(income, lambda r: r.eps_diluted or r.eps)
        eps_yoy = yoy_ratio(latest_eps, prior_eps)
        base, eps_chips = _apply_growth_delta(base, eps_yoy, label="EPS")
        chips.extend(eps_chips)
    else:
        chips.append("Limited history — YoY requires 5 quarters")

    if len(income) >= 13:
        start_rev = income[12].revenue
        end_rev = income[0].revenue
        rev_cagr = cagr(start_rev or 0, end_rev or 0, 3)
        if rev_cagr is not None:
            if rev_cagr >= 0.10:
                base = apply_score_delta(base, 8)
                chips.append(f"3Y revenue CAGR {rev_cagr:.0%}")
            elif rev_cagr < 0:
                base = apply_score_delta(base, -8)
                chips.append(f"3Y revenue CAGR {rev_cagr:.0%} — negative")

    gd = (guidance_direction or "unknown").strip().lower()
    if gd == "raised":
        base = apply_score_delta(base, 6)
        chips.append("Guidance raised")
    elif gd in {"lowered", "cut"}:
        base = apply_score_delta(base, -10)
        chips.append("Guidance lowered")

    rt = (revenue_trend or "unknown").strip().lower()
    if rt == "growing":
        base = apply_score_delta(base, 4)
    elif rt == "declining":
        base = apply_score_delta(base, -6)

    score, verdict = finalize_pillar_score(base)
    reasoning = (
        f"Growth read {score}/100 — "
        + (chips[0] if chips else "mixed growth signals")
        + ". Signal data only."
    )
    return PositionPillarResult(
        pillar_id="F2",
        label=PILLAR_LABELS["F2"],
        weight=PILLAR_WEIGHTS["F2"],
        status="active",
        score=score,
        verdict=verdict,
        reasoning=reasoning,
        chips=chips[:6],
        data_quality=quality,
        as_of_date=latest_as_of(income),
    )
