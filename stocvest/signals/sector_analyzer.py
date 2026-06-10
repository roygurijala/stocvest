"""Layer 4 — sector ETF vs SPY relative strength."""

from __future__ import annotations

from dataclasses import dataclass, field

from stocvest.config.signal_parameters import SectorParameters
from stocvest.data.models import Snapshot
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_momentum import SectorMomentumScore
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


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
        use_weekly: bool = False,
        weekly_sector_pct: float | None = None,
        weekly_spy_pct: float | None = None,
        resolution_state: SectorResolutionState | None = None,
        sector_momentum: SectorMomentumScore | None = None,
        mode: str = "day",
    ) -> SectorLayerResult:
        sym_u = (symbol or "").strip().upper() or "?"

        if resolution_state == SectorResolutionState.PENDING_REFRESH:
            return SectorLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                sector_etf=None,
                sector_name=sector_display_name,
                sector_signal="neutral",
                reasoning=(
                    "Sector momentum is not in the composite yet — sector cache is still refreshing. "
                    "This layer is excluded until data is ready; it does not count as neutral disagreement "
                    "and does not reduce alignment vs other layers."
                ),
                chips=["Unavailable · not factored in composite"],
            )

        if (
            sector_momentum
            and sector_momentum.data_available
            and resolution_state == SectorResolutionState.RESOLVED
        ):
            return self._from_momentum(
                sym_u,
                sector_momentum,
                sector_etf_snapshot,
                spy_snapshot,
                params,
                sector_display_name=sector_display_name,
                use_weekly=use_weekly,
                weekly_sector_pct=weekly_sector_pct,
                weekly_spy_pct=weekly_spy_pct,
                mode=mode,
            )

        if resolution_state == SectorResolutionState.UNMAPPED:
            return self._unmapped_spy_path(
                sym_u,
                sector_etf_snapshot,
                spy_snapshot,
                params,
                sector_display_name=sector_display_name,
                use_weekly=use_weekly,
                weekly_sector_pct=weekly_sector_pct,
                weekly_spy_pct=weekly_spy_pct,
            )

        if sector_etf_snapshot is None or spy_snapshot is None:
            return SectorLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="Sector or SPY snapshot missing.",
                chips=[],
            )
        if use_weekly:
            if weekly_sector_pct is None or weekly_spy_pct is None:
                return SectorLayerResult(
                    status="unavailable",
                    score=None,
                    verdict="neutral",
                    reasoning="Weekly sector/SPY performance not available for relative strength.",
                    chips=[],
                )
            sector_pct = float(weekly_sector_pct)
            spy_pct = float(weekly_spy_pct)
        else:
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
        etf_u = (etf or "").strip().upper()
        period = "5d" if use_weekly else "1d"

        if etf_u == "SPY":
            chips = [
                f"Broad market (SPY) {sector_pct:+.2f}% ({period}) — no separate sector ETF",
            ]
            reasoning = (
                f"Sector layer uses SPY as the benchmark (no distinct sector index). "
                f"SPY {sector_pct:+.2f}% vs SPY leg {spy_pct:+.2f}% ({period}); spread {relative:+.2f}% "
                f"(near zero when both snapshots are SPY) → score {final}."
            )
            _LOG.info(
                "sector_layer_spy_proxy symbol=%s day_pct=%.4f spy_leg_pct=%.4f spread=%.4f score=%s",
                sym_u,
                sector_pct,
                spy_pct,
                relative,
                final,
            )
        else:
            chips = [
                f"{etf} {sector_pct:+.2f}% ({period})",
                f"Rel. vs SPY: {relative:+.2f}% ({period})",
            ]
            reasoning = (
                f"Sector {etf} {sector_pct:+.2f}% vs SPY {spy_pct:+.2f}% "
                f"({period} rel {relative:+.2f}%) → score {final}."
            )

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
            reasoning=reasoning,
            chips=chips,
        )

    def _from_momentum(
        self,
        sym_u: str,
        momentum: SectorMomentumScore,
        sector_etf_snapshot: Snapshot | None,
        spy_snapshot: Snapshot | None,
        params: SectorParameters,
        *,
        sector_display_name: str | None,
        use_weekly: bool,
        weekly_sector_pct: float | None,
        weekly_spy_pct: float | None,
        mode: str,
    ) -> SectorLayerResult:
        sc = int(round(max(0, min(100, momentum.score))))
        verdict = momentum.verdict
        sector_signal = verdict if verdict in ("bullish", "bearish") else "neutral"

        sector_pct: float | None = None
        spy_pct: float | None = None
        if use_weekly and weekly_sector_pct is not None and weekly_spy_pct is not None:
            sector_pct = float(weekly_sector_pct)
            spy_pct = float(weekly_spy_pct)
        elif sector_etf_snapshot and spy_snapshot:
            if sector_etf_snapshot.change_percent is not None and spy_snapshot.change_percent is not None:
                sector_pct = float(sector_etf_snapshot.change_percent)
                spy_pct = float(spy_snapshot.change_percent)

        chips = [momentum.interpretation_chip]
        period = "5d" if use_weekly else "1d"
        if mode == "swing" and period == "5d":
            chips.append(f"{momentum.etf} {momentum.rel_5d:+.1f}% (5d vs SPY)")
        else:
            chips.append(f"{momentum.etf} {momentum.rel_1d:+.2f}% today vs SPY")

        reasoning = (
            f"Sector momentum ({mode}) score {momentum.score:.1f} ({verdict}): persistence "
            f"{momentum.persistence:.2f} over {momentum.total_sessions} sessions; "
            f"1d rel {momentum.rel_1d:+.2f}%, 5d cum rel {momentum.rel_5d:+.2f}% vs SPY."
        )
        _LOG.info(
            "sector_layer_momentum symbol=%s etf=%s score=%s verdict=%s persistence=%.2f",
            sym_u,
            momentum.etf,
            sc,
            verdict,
            momentum.persistence,
        )
        return SectorLayerResult(
            status="available",
            score=sc,
            verdict=verdict,
            sector_etf=momentum.etf,
            sector_name=sector_display_name,
            sector_day_pct=sector_pct,
            spy_day_pct=spy_pct,
            relative_strength=momentum.rel_1d,
            sector_signal=sector_signal,
            reasoning=reasoning,
            chips=chips,
        )

    def _unmapped_spy_path(
        self,
        sym_u: str,
        sector_etf_snapshot: Snapshot | None,
        spy_snapshot: Snapshot | None,
        params: SectorParameters,
        *,
        sector_display_name: str | None,
        use_weekly: bool,
        weekly_sector_pct: float | None,
        weekly_spy_pct: float | None,
    ) -> SectorLayerResult:
        chips = ["Broad market (SPY)"]
        reasoning = (
            "This company does not map cleanly to a single sector benchmark. Broad market (SPY) used for context."
        )
        if sector_etf_snapshot is None or spy_snapshot is None:
            return SectorLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                sector_etf="SPY",
                sector_name=sector_display_name,
                reasoning=reasoning + " Snapshot data missing.",
                chips=chips,
            )
        if use_weekly:
            if weekly_sector_pct is None or weekly_spy_pct is None:
                return SectorLayerResult(
                    status="unavailable",
                    score=None,
                    verdict="neutral",
                    sector_etf="SPY",
                    reasoning=reasoning + " Weekly data unavailable.",
                    chips=chips,
                )
            sector_pct = float(weekly_sector_pct)
            spy_pct = float(weekly_spy_pct)
        else:
            if sector_etf_snapshot.change_percent is None or spy_snapshot.change_percent is None:
                return SectorLayerResult(
                    status="unavailable",
                    score=None,
                    verdict="neutral",
                    sector_etf="SPY",
                    reasoning=reasoning + " Change percent unavailable.",
                    chips=chips,
                )
            sector_pct = float(sector_etf_snapshot.change_percent)
            spy_pct = float(spy_snapshot.change_percent)
        relative = sector_pct - spy_pct
        # Score SPY's absolute performance through the same threshold table as
        # mapped symbols rather than hardlocking at inline_score (50). A strong
        # or weak SPY session carries real information even for unmapped stocks.
        if sector_pct > params.absolute_up_threshold:
            base = float(params.moderate_outperform_score)
        elif sector_pct < params.absolute_down_threshold:
            base = float(params.moderate_underperform_score)
        else:
            base = float(params.inline_score)
        final = _clamp_i(base, 0, 100)
        if final >= params.bullish_threshold:
            spy_signal = "bullish"
            spy_verdict = "bullish"
        elif final <= params.bearish_threshold:
            spy_signal = "bearish"
            spy_verdict = "bearish"
        else:
            spy_signal = "neutral"
            spy_verdict = "neutral"
        return SectorLayerResult(
            status="available",
            score=final,
            verdict=spy_verdict,
            sector_etf="SPY",
            sector_name=sector_display_name,
            sector_day_pct=sector_pct,
            spy_day_pct=spy_pct,
            relative_strength=relative,
            sector_signal=spy_signal,
            reasoning=reasoning + f" SPY {sector_pct:+.2f}% → score {final}.",
            chips=chips,
        )
