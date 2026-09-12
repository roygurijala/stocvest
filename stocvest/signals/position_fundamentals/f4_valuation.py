"""F4 — Valuation pillar with value-trap guard."""

from __future__ import annotations

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import (
    apply_score_delta,
    finalize_pillar_score,
    latest_as_of,
    median_value,
    normalize_positive_multiple,
    pillar_data_quality,
    prioritize_chips,
    quarter_offset_value,
    series_values,
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

VALUE_TRAP_PE_MAX = 15.0
VALUE_TRAP_SCORE_CAP = 55

#: Cap on the EPS-growth rate (fractional) used in the PEG denominator. A one-off earnings
#: spike off a low base can otherwise manufacture an artificially "cheap" PEG; capping the
#: denominator keeps a 50% print and a 200% print from both reading as near-zero PEG.
PEG_GROWTH_CAP = 0.50


def _eps_value(row: object) -> float | None:
    """Diluted EPS preferred; fall back to basic EPS."""
    eps_diluted = getattr(row, "eps_diluted", None)
    if eps_diluted is not None:
        return eps_diluted
    return getattr(row, "eps", None)


def _ttm_eps_growth(snapshot: PositionFundamentalsSnapshot) -> float | None:
    """TTM-EPS YoY growth (fractional): last-4Q EPS sum vs the prior-4Q sum.

    Smoother than a single-quarter YoY. Needs 8 quarters; falls back to single-quarter
    YoY (needs 5) when only 5-7 quarters exist. Returns None when EPS is missing or the
    YoY sign guard trips (see ``yoy_ratio``), so PEG callers cleanly fall back.
    """
    income = sorted(snapshot.income_statements, key=lambda r: r.as_of_date, reverse=True)
    if len(income) >= 8:
        cur = [_eps_value(r) for r in income[:4]]
        prior = [_eps_value(r) for r in income[4:8]]
        if all(v is not None for v in cur) and all(v is not None for v in prior):
            return yoy_ratio(sum(cur), sum(prior))  # type: ignore[arg-type]
    latest, prior_q = quarter_offset_value(income, _eps_value, offset=4)
    return yoy_ratio(latest, prior_q)


def _score_peg(
    base: float,
    pe: float | None,
    eps_growth: float | None,
) -> tuple[float, list[str], bool]:
    """Growth-adjusted P/E (PEG). Returns (base, chips, applied).

    ``applied`` is False when PEG is not usable (no P/E, or non-positive/absent growth),
    signalling the caller to fall back to the own-8Q-median P/E read. When applied, this
    REPLACES the own-history P/E delta so P/E is never scored twice.
    """
    chips: list[str] = []
    if pe is None or eps_growth is None or eps_growth <= 0:
        return base, chips, False
    growth = min(eps_growth, PEG_GROWTH_CAP)
    peg = pe / (growth * 100.0)
    if peg <= 1.0:
        base = apply_score_delta(base, 10)
        chips.append(f"PEG {peg:.1f} — cheap for its growth")
    elif peg <= 1.5:
        base = apply_score_delta(base, 5)
        chips.append(f"PEG {peg:.1f} — reasonable for growth")
    elif peg <= 2.0:
        chips.append(f"PEG {peg:.1f} — fair vs growth")
    elif peg <= 3.0:
        base = apply_score_delta(base, -5)
        chips.append(f"PEG {peg:.1f} — full vs growth")
    else:
        base = apply_score_delta(base, -10)
        chips.append(f"PEG {peg:.1f} — expensive vs growth")
    return base, chips, True


def _ev_sales_graded_delta(ev_metric: float) -> tuple[int, bool]:
    """Monotonic EV/Sales ladder (delta, is_rich). Replaces the single -6 cliff at 8x."""
    if ev_metric < 2.0:
        return 6, False
    if ev_metric < 4.0:
        return 4, False
    if ev_metric < 6.0:
        return 2, False
    if ev_metric < 8.0:
        return 0, False
    if ev_metric < 11.0:
        return -2, True
    if ev_metric < 15.0:
        return -4, True
    return -6, True


def _score_vs_history(
    base: float,
    current: float | None,
    history: list[float],
    *,
    label: str,
    lower_is_cheaper: bool = True,
) -> tuple[float, list[str]]:
    chips: list[str] = []
    if current is None or not history:
        return base, chips
    med = median_value(history)
    if med is None or med <= 0:
        return base, chips
    ratio = current / med
    if lower_is_cheaper:
        if ratio <= 0.85:
            base = apply_score_delta(base, 10)
            chips.append(f"{label} below 8Q median — reasonable")
        elif ratio >= 1.25:
            base = apply_score_delta(base, -10)
            chips.append(f"{label} above 8Q median — stretched")
        else:
            chips.append(f"{label} near 8Q median")
    return base, chips


def apply_value_trap_guard(
    pillar: PositionPillarResult,
    *,
    f2_verdict: str,
    f2_score: int | None,
    pe_ratio: float | None,
) -> PositionPillarResult:
    weak_growth = f2_verdict == "bearish" or (f2_score is not None and f2_score < 45)
    low_multiple = pe_ratio is not None and 0 < pe_ratio < VALUE_TRAP_PE_MAX
    if not (weak_growth and low_multiple):
        return pillar

    capped_score = min(pillar.score or VALUE_TRAP_SCORE_CAP, VALUE_TRAP_SCORE_CAP)
    verdict: str = pillar.verdict
    if verdict == "bullish":
        verdict = "neutral"
    guard_chip = "Value-trap guard: low multiple with weak growth"
    reasoning = (
        f"Valuation read {capped_score}/100 — multiple looks low but growth is weak; "
        "treat as neutral until growth confirms. Signal data only."
    )
    return PositionPillarResult(
        pillar_id=pillar.pillar_id,
        label=pillar.label,
        weight=pillar.weight,
        status=pillar.status,
        score=capped_score,
        verdict=verdict,  # type: ignore[arg-type]
        reasoning=reasoning,
        chips=prioritize_chips([guard_chip], list(pillar.chips)),
        data_quality=pillar.data_quality,
        as_of_date=pillar.as_of_date,
    )


def _ttm_revenue(snapshot: PositionFundamentalsSnapshot) -> float | None:
    """Trailing-twelve-month revenue = sum of the latest 4 quarterly revenues.

    Returns None when fewer than 4 quarters or the sum is not positive, so callers can
    skip an EV/Sales read rather than fall back to a misleading single-quarter multiple.
    """
    income = sorted(snapshot.income_statements, key=lambda r: r.as_of_date, reverse=True)
    revs = [i.revenue for i in income[:4] if i.revenue is not None]
    if len(revs) < 4:
        return None
    total = sum(revs)
    return float(total) if total > 0 else None


def score_f4_valuation(
    snapshot: PositionFundamentalsSnapshot,
    *,
    sector_flags: SectorOverrideFlags | None = None,
    f2_verdict: str = "neutral",
    f2_score: int | None = None,
    fundamentals_v2: bool = False,
    valuation_peg: bool = False,
) -> PositionPillarResult:
    flags = sector_flags or SectorOverrideFlags()
    ratios = sorted(snapshot.ratios, key=lambda r: r.as_of_date, reverse=True)
    metrics = sorted(snapshot.key_metrics, key=lambda r: r.as_of_date, reverse=True)

    if not ratios and not metrics:
        return unavailable_pillar("F4", reason="Valuation inputs unavailable.")

    quality = pillar_data_quality(max(len(ratios), len(metrics)))
    base = float(LAYER_SCORE_NEUTRAL)
    chips: list[str] = []

    if flags.de_weight_valuation:
        base = apply_score_delta(base, -5)
        chips.append(flags.valuation_note or "Pre-profit sector — valuation de-weighted")

    latest_pe = None
    if ratios:
        latest_pe = normalize_positive_multiple(ratios[0].price_earnings_ratio)
    if latest_pe is None and metrics:
        latest_pe = normalize_positive_multiple(metrics[0].pe_ratio)

    pe_applied_via_peg = False
    if valuation_peg:
        eps_growth = _ttm_eps_growth(snapshot)
        base, peg_chips, pe_applied_via_peg = _score_peg(base, latest_pe, eps_growth)
        chips.extend(peg_chips)
    if not pe_applied_via_peg:
        pe_hist = series_values(
            ratios[:8],
            lambda r: normalize_positive_multiple(r.price_earnings_ratio),
        )
        base, pe_chips = _score_vs_history(base, latest_pe, pe_hist, label="P/E")
        chips.extend(pe_chips)

    pfcf_hist = series_values(
        ratios[:8],
        lambda r: normalize_positive_multiple(r.price_to_free_cash_flow),
    )
    latest_pfcf = normalize_positive_multiple(ratios[0].price_to_free_cash_flow) if ratios else None
    base, pfcf_chips = _score_vs_history(base, latest_pfcf, pfcf_hist, label="P/FCF")
    chips.extend(pfcf_chips)

    if metrics:
        ev_metric: float | None
        ev_suffix = ""
        if fundamentals_v2:
            # v2: derive EV/Sales from enterprise value ÷ TTM revenue. FMP's quarterly
            # `evToSales` is EV ÷ a single quarter's revenue (~4x the annual multiple), which
            # over-penalizes growth names (e.g. SOFI showed 14.8 vs a true TTM 4.2). Skip the
            # read entirely when TTM revenue / EV are unavailable rather than use that value.
            ttm_rev = _ttm_revenue(snapshot)
            ev_value = metrics[0].enterprise_value
            ev_metric = (
                float(ev_value) / ttm_rev
                if ev_value is not None and ev_value > 0 and ttm_rev
                else None
            )
            ev_suffix = " (TTM)"
        else:
            ev_metric = normalize_positive_multiple(metrics[0].ev_to_sales)
        if ev_metric is not None:
            if valuation_peg:
                ev_delta, ev_rich = _ev_sales_graded_delta(ev_metric)
                if ev_delta != 0:
                    base = apply_score_delta(base, ev_delta)
                suffix = f"{ev_suffix} — rich" if ev_rich else ev_suffix
                chips.append(f"EV/Sales {ev_metric:.1f}{suffix}")
            elif ev_metric <= 3.0:
                base = apply_score_delta(base, 6)
                chips.append(f"EV/Sales {ev_metric:.1f}{ev_suffix}")
            elif ev_metric >= 8.0:
                base = apply_score_delta(base, -6)
                chips.append(f"EV/Sales {ev_metric:.1f}{ev_suffix} — rich")

    score, verdict = finalize_pillar_score(base)
    pillar = PositionPillarResult(
        pillar_id="F4",
        label=PILLAR_LABELS["F4"],
        weight=PILLAR_WEIGHTS["F4"],
        status="active",
        score=score,
        verdict=verdict,
        reasoning=(
            f"Valuation read {score}/100 — "
            + (chips[0] if chips else "mixed valuation signals")
            + ". Signal data only."
        ),
        chips=chips[:6],
        data_quality=quality,
        as_of_date=latest_as_of(ratios or metrics),
    )
    return apply_value_trap_guard(
        pillar,
        f2_verdict=f2_verdict,
        f2_score=f2_score,
        pe_ratio=latest_pe,
    )
