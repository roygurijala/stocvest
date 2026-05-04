"""Layer 4 — sector ETF vs SPY relative strength."""

from __future__ import annotations

from dataclasses import dataclass, field

from stocvest.config.signal_parameters import SectorParameters
from stocvest.data.models import Snapshot


def _clamp_i(x: float, lo: int, hi: int) -> int:
    return int(max(lo, min(hi, round(x))))


@dataclass
class SectorLayerResult:
    status: str
    score: int | None
    verdict: str
    sector_etf: str | None = None
    sector_name: str | None = None
    sector_day_pct: float | None = None
    spy_day_pct: float | None = None
    relative_strength: float | None = None
    sector_signal: str = "neutral"
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)


class SectorAnalyzer:
    def analyze(
        self,
        symbol: str,
        sector_etf_snapshot: Snapshot | None,
        spy_snapshot: Snapshot | None,
        params: SectorParameters,
        *,
        sector_display_name: str | None = None,
    ) -> SectorLayerResult:
        _ = symbol
        if sector_etf_snapshot is None or spy_snapshot is None:
            return SectorLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="Sector or SPY snapshot missing.",
                chips=[],
            )
        if sector_etf_snapshot.change_percent is None or spy_snapshot.change_percent is None:
            return SectorLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="Change percent unavailable on sector or SPY snapshot.",
                chips=[],
            )

        sector_pct = float(sector_etf_snapshot.change_percent)
        spy_pct = float(spy_snapshot.change_percent)
        relative = sector_pct - spy_pct

        if relative > params.strong_outperform:
            base = float(params.strong_outperform_score)
        elif relative > params.moderate_outperform:
            base = float(params.moderate_outperform_score)
        elif relative > -params.moderate_outperform:
            base = float(params.inline_score)
        elif relative > params.moderate_underperform:
            base = float(params.moderate_underperform_score)
        else:
            base = float(params.strong_underperform_score)

        if sector_pct > params.absolute_up_threshold:
            base += params.absolute_adjustment
        elif sector_pct < params.absolute_down_threshold:
            base -= params.absolute_adjustment

        final = _clamp_i(base, 0, 100)

        if final >= params.bullish_threshold:
            sector_signal = "bullish"
        elif final <= params.bearish_threshold:
            sector_signal = "bearish"
        else:
            sector_signal = "neutral"

        if final >= params.bullish_threshold:
            verdict = "bullish"
        elif final <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        etf = sector_etf_snapshot.symbol
        chips = [f"{etf} {sector_pct:+.2f}%", f"vs SPY {relative:+.2f}%"]

        return SectorLayerResult(
            status="available",
            score=final,
            verdict=verdict,
            sector_etf=etf,
            sector_name=sector_display_name,
            sector_day_pct=sector_pct,
            spy_day_pct=spy_pct,
            relative_strength=relative,
            sector_signal=sector_signal,
            reasoning=(
                f"Sector {etf} {sector_pct:+.2f}% vs SPY {spy_pct:+.2f}% "
                f"(rel {relative:+.2f}%) → score {final}."
            ),
            chips=chips,
        )
