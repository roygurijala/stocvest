"""Position fundamentals layer analyzer — aggregates F1–F5 pillars (POS-D2)."""

from __future__ import annotations

from dataclasses import dataclass

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.common import score_to_verdict
from stocvest.signals.position_fundamentals.f1_profitability import score_f1_profitability
from stocvest.signals.position_fundamentals.f2_growth import score_f2_growth
from stocvest.signals.position_fundamentals.f3_balance_sheet import score_f3_balance_sheet
from stocvest.signals.position_fundamentals.f4_valuation import score_f4_valuation
from stocvest.signals.position_fundamentals.f5_earnings_quality import score_f5_earnings_quality
from stocvest.signals.position_fundamentals.sector_overrides import resolve_sector_override_flags
from stocvest.signals.position_fundamentals.types import (
    PILLAR_WEIGHTS,
    PillarId,
    PillarVerdict,
    PositionFundamentalsLayerResult,
    PositionPillarResult,
)
from stocvest.signals.signal_math_contract import clamp_layer_score


@dataclass(frozen=True)
class PositionFundamentalsContext:
    """Optional swing/backdrop context wired into growth & earnings-quality pillars."""

    guidance_direction: str = "unknown"
    revenue_trend: str = "unknown"
    earnings_trend: str = "unknown"
    quarters_beating: int = 0
    quarters_missing: int = 0
    sector_bucket: str | None = None
    #: Fundamentals v2 (EV/Sales TTM + bank FCF/current-ratio suppression). Graduated to ON
    #: by default via config (2026-09-12); when False the F1/F3/F4 scorers are byte-identical
    #: to v1. This dataclass default stays False so unit tests opt in explicitly.
    fundamentals_v2: bool = False


def prepare_snapshot(snapshot: PositionFundamentalsSnapshot) -> PositionFundamentalsSnapshot:
    """Ensure statement rows are newest-first (defensive against unsorted inputs)."""

    def _sort(rows: list) -> list:
        return sorted(rows, key=lambda r: r.as_of_date, reverse=True)

    return snapshot.model_copy(
        update={
            "income_statements": _sort(list(snapshot.income_statements)),
            "balance_sheets": _sort(list(snapshot.balance_sheets)),
            "cash_flows": _sort(list(snapshot.cash_flows)),
            "ratios": _sort(list(snapshot.ratios)),
            "key_metrics": _sort(list(snapshot.key_metrics)),
        }
    )


def aggregate_pillar_scores(pillars: list[PositionPillarResult]) -> tuple[int | None, PillarVerdict]:
    active = [p for p in pillars if p.status == "active" and p.score is not None]
    if not active:
        return None, "neutral"
    total_weight = sum(PILLAR_WEIGHTS[p.pillar_id] for p in active)
    if total_weight <= 0:
        return None, "neutral"
    blended = sum(float(p.score) * PILLAR_WEIGHTS[p.pillar_id] for p in active) / total_weight
    score = int(round(clamp_layer_score(blended)))
    return score, score_to_verdict(float(score))


def weakest_pillar(pillars: list[PositionPillarResult]) -> PillarId | None:
    scored = [p for p in pillars if p.score is not None and p.status == "active"]
    if not scored:
        return None
    weakest_score = min(p.score for p in scored if p.score is not None)
    candidates = [p for p in scored if p.score == weakest_score]
    return min(candidates, key=lambda p: p.pillar_id).pillar_id


def layer_data_quality(pillars: list[PositionPillarResult]) -> str:
    qualities = [p.data_quality for p in pillars if p.data_quality != "unavailable"]
    if not qualities:
        return "unavailable"
    rank = {"high": 3, "medium": 2, "low": 1}
    return min(qualities, key=lambda q: rank.get(q, 0))


class PositionFundamentalsAnalyzer:
    def analyze(
        self,
        snapshot: PositionFundamentalsSnapshot,
        *,
        context: PositionFundamentalsContext | None = None,
    ) -> PositionFundamentalsLayerResult:
        ctx = context or PositionFundamentalsContext()
        flags = resolve_sector_override_flags(ctx.sector_bucket)
        snap = prepare_snapshot(snapshot)

        if not snap.configured:
            return PositionFundamentalsLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="Fundamentals provider not configured — layer excluded.",
                chips=["Fundamentals unavailable"],
                data_quality="unavailable",
            )

        f2 = score_f2_growth(
            snap,
            guidance_direction=ctx.guidance_direction,
            revenue_trend=ctx.revenue_trend,
        )
        pillars: list[PositionPillarResult] = [
            score_f1_profitability(snap, sector_flags=flags, fundamentals_v2=ctx.fundamentals_v2),
            f2,
            score_f3_balance_sheet(snap, sector_flags=flags, fundamentals_v2=ctx.fundamentals_v2),
            score_f4_valuation(
                snap,
                sector_flags=flags,
                f2_verdict=f2.verdict,
                f2_score=f2.score,
                fundamentals_v2=ctx.fundamentals_v2,
            ),
            score_f5_earnings_quality(
                snap,
                quarters_beating=ctx.quarters_beating,
                quarters_missing=ctx.quarters_missing,
                earnings_trend=ctx.earnings_trend,
            ),
        ]

        score, verdict = aggregate_pillar_scores(pillars)
        active_count = sum(1 for p in pillars if p.status == "active" and p.score is not None)
        if score is None or active_count == 0:
            status = "unavailable"
            reasoning = "Insufficient fundamentals coverage for a layer score."
            verdict = "neutral"
        elif active_count < len(pillars):
            status = "degraded"
            reasoning = (
                f"Fundamentals layer {score}/100 ({verdict}) — "
                f"{active_count}/{len(pillars)} pillars scored. Signal data only."
            )
        else:
            status = "active"
            reasoning = f"Fundamentals layer {score}/100 ({verdict}). Signal data only."

        weak = weakest_pillar(pillars)
        chips: list[str] = []
        if weak is not None:
            weak_p = next(p for p in pillars if p.pillar_id == weak)
            if weak_p.score is not None:
                chips.append(f"Weakest: {weak} {weak_p.score}/100")

        return PositionFundamentalsLayerResult(
            status=status,
            score=score,
            verdict=verdict,
            reasoning=reasoning,
            chips=chips,
            pillars=pillars,
            data_quality=layer_data_quality(pillars),
            weakest_pillar_id=weak,
        )
