"""F5 — Earnings quality & consistency pillar."""

from __future__ import annotations

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import (
    apply_score_delta,
    clamp_non_negative_int,
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


def score_f5_earnings_quality(
    snapshot: PositionFundamentalsSnapshot,
    *,
    quarters_beating: int = 0,
    quarters_missing: int = 0,
    earnings_trend: str = "unknown",
) -> PositionPillarResult:
    income = snapshot.income_statements
    cash = snapshot.cash_flows
    balance = snapshot.balance_sheets

    if not income or not cash:
        return unavailable_pillar("F5", reason="Need income and cash flow for earnings quality.")

    quality = pillar_data_quality(min(len(income), len(cash)))
    base = float(LAYER_SCORE_NEUTRAL)
    chips: list[str] = []

    beats = clamp_non_negative_int(quarters_beating)
    misses = clamp_non_negative_int(quarters_missing)
    total_quarters = beats + misses
    if total_quarters >= 3:
        if beats >= 3 and misses == 0:
            base = apply_score_delta(base, 14)
            chips.append(f"Beat streak {beats}/{total_quarters}")
        elif misses >= 3:
            base = apply_score_delta(base, -14)
            chips.append(f"Miss streak {misses}/{total_quarters}")
        elif beats > misses:
            base = apply_score_delta(base, 6)
            chips.append(f"More beats than misses ({beats}/{total_quarters})")
        elif misses > beats:
            base = apply_score_delta(base, -6)
            chips.append(f"More misses than beats ({misses}/{total_quarters})")

    et = (earnings_trend or "unknown").strip().lower()
    if et == "beating":
        base = apply_score_delta(base, 6)
    elif et == "missing":
        base = apply_score_delta(base, -8)

    assets = balance[0].total_assets if balance else None
    ni = income[0].net_income
    ocf = cash[0].operating_cash_flow
    if assets and assets > 0 and ni is not None and ocf is not None:
        accrual_ratio = (ni - ocf) / assets
        if accrual_ratio <= 0.02:
            base = apply_score_delta(base, 8)
            chips.append("Cash earnings align with net income")
        elif accrual_ratio >= 0.08:
            base = apply_score_delta(base, -12)
            chips.append("High accruals vs operating cash flow")

    latest_rev, prior_rev = quarter_offset_value(income, lambda r: r.revenue)
    latest_eps, prior_eps = quarter_offset_value(income, lambda r: r.eps_diluted or r.eps)
    rev_yoy = yoy_ratio(latest_rev, prior_rev)
    eps_yoy = yoy_ratio(latest_eps, prior_eps)
    if rev_yoy is not None and eps_yoy is not None:
        if rev_yoy > 0.05 and eps_yoy < -0.05:
            base = apply_score_delta(base, -10)
            chips.append("EPS lagging revenue growth")
        elif rev_yoy < 0 and eps_yoy > 0.05:
            base = apply_score_delta(base, -6)
            chips.append("EPS up while revenue declines")

    score, verdict = finalize_pillar_score(base)
    reasoning = (
        f"Earnings quality read {score}/100 — "
        + (chips[0] if chips else "mixed earnings quality signals")
        + ". Signal data only."
    )
    return PositionPillarResult(
        pillar_id="F5",
        label=PILLAR_LABELS["F5"],
        weight=PILLAR_WEIGHTS["F5"],
        status="active",
        score=score,
        verdict=verdict,
        reasoning=reasoning,
        chips=chips[:6],
        data_quality=quality,
        as_of_date=latest_as_of(income),
    )
