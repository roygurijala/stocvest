"""F1 — Profitability & quality pillar."""

from __future__ import annotations

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import (
    apply_score_delta,
    finalize_pillar_score,
    latest_as_of,
    normalize_pct_rate,
    pillar_data_quality,
    prioritize_chips,
    quarter_offset_value,
    series_values,
    std_dev,
    unavailable_pillar,
    yoy_ratio,
)
from stocvest.signals.position_fundamentals.sector_overrides import SectorOverrideFlags
from stocvest.signals.position_fundamentals.types import (
    PILLAR_LABELS,
    PILLAR_WEIGHTS,
    PositionPillarResult,
)
from stocvest.signals.signal_math_contract import LAYER_SCORE_NEUTRAL


def score_f1_profitability(
    snapshot: PositionFundamentalsSnapshot,
    *,
    sector_flags: SectorOverrideFlags | None = None,
    fundamentals_v2: bool = False,
) -> PositionPillarResult:
    flags = sector_flags or SectorOverrideFlags()
    ratios = snapshot.ratios
    income = snapshot.income_statements
    cash = snapshot.cash_flows

    if not ratios and not income:
        return unavailable_pillar("F1", reason="Profitability inputs unavailable.")

    quality = pillar_data_quality(max(len(ratios), len(income)))
    base = float(LAYER_SCORE_NEUTRAL)
    chips: list[str] = []

    latest_ratio = ratios[0] if ratios else None
    if latest_ratio is not None:
        roe = normalize_pct_rate(latest_ratio.return_on_equity)
        if roe is not None:
            if roe >= 0.20:
                base = apply_score_delta(base, 14)
                chips.append(f"ROE {roe:.0%} — strong")
            elif roe >= 0.12:
                base = apply_score_delta(base, 8)
                chips.append(f"ROE {roe:.0%} — solid")
            elif roe < 0.05:
                base = apply_score_delta(base, -12)
                chips.append(f"ROE {roe:.0%} — weak")

        quality_metric = normalize_pct_rate(
            latest_ratio.return_on_assets
            if flags.use_roa_not_roic
            else latest_ratio.return_on_capital_employed or latest_ratio.return_on_assets
        )
        if quality_metric is not None:
            label = "ROA" if flags.use_roa_not_roic else "ROIC/ROCE"
            if quality_metric >= 0.12:
                base = apply_score_delta(base, 10)
                chips.append(f"{label} {quality_metric:.0%} — efficient")
            elif quality_metric < 0.04:
                base = apply_score_delta(base, -10)
                chips.append(f"{label} {quality_metric:.0%} — low")
            elif flags.use_roa_not_roic:
                chips.append(f"{label} {quality_metric:.0%}")

        for margin, name in (
            (normalize_pct_rate(latest_ratio.gross_profit_margin), "Gross margin"),
            (normalize_pct_rate(latest_ratio.operating_profit_margin), "Operating margin"),
            (normalize_pct_rate(latest_ratio.net_profit_margin), "Net margin"),
        ):
            if margin is not None and margin >= 0.15:
                base = apply_score_delta(base, 4)
                chips.append(f"{name} {margin:.0%}")

    if fundamentals_v2 and flags.suppress_fcf_penalty:
        # Lenders (banks/consumer finance): FCF is dominated by loan originations held on
        # balance sheet, so it is structurally negative even when GAAP-profitable. Do not
        # score it — surface as context so the glass-box read explains why.
        chips.append("FCF not scored — lender (loan book drives cash flow)")
    elif income and cash:
        rev = income[0].revenue
        fcf = cash[0].free_cash_flow
        if rev and rev > 0 and fcf is not None:
            if fcf < 0:
                base = apply_score_delta(base, -12)
                chips.insert(0, "Negative free cash flow")
            else:
                fcf_margin = fcf / rev
                if fcf_margin >= 0.15:
                    base = apply_score_delta(base, 10)
                    chips.append(f"FCF margin {fcf_margin:.0%}")

    if len(ratios) >= 5:
        _, prior_net_margin = quarter_offset_value(
            ratios,
            lambda r: normalize_pct_rate(r.net_profit_margin),
        )
        latest_net = normalize_pct_rate(ratios[0].net_profit_margin)
        margin_yoy = yoy_ratio(latest_net, prior_net_margin)
        if margin_yoy is not None:
            if margin_yoy > 0.05:
                base = apply_score_delta(base, 8)
                chips.append("Net margin expanding YoY")
            elif margin_yoy < -0.05:
                base = apply_score_delta(base, -8)
                chips.append("Net margin compressing YoY")

    margin_series = series_values(ratios[:8], lambda r: normalize_pct_rate(r.net_profit_margin))
    margin_std = std_dev(margin_series)
    if margin_std is not None:
        if margin_std <= 0.03:
            base = apply_score_delta(base, 5)
            chips.append("Stable margins (8Q)")
        elif margin_std >= 0.08:
            base = apply_score_delta(base, -5)
            chips.append("Volatile margins (8Q)")

    score, verdict = finalize_pillar_score(base)
    reasoning = (
        f"Profitability read {score}/100 — "
        + (chips[0] if chips else "mixed profitability signals")
        + ". Signal data only."
    )
    return PositionPillarResult(
        pillar_id="F1",
        label=PILLAR_LABELS["F1"],
        weight=PILLAR_WEIGHTS["F1"],
        status="active",
        score=score,
        verdict=verdict,
        reasoning=reasoning,
        chips=chips[:6],
        data_quality=quality,
        as_of_date=latest_as_of(ratios or income),
    )
