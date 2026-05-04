"""Layer 6 — VIX + SPY breadth proxy + SPY/QQQ participation."""

from __future__ import annotations

from dataclasses import dataclass, field

from stocvest.config.signal_parameters import MacroParameters
from stocvest.data.models import Snapshot
from stocvest.signals.morning_brief import vix_direction_from_change


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


@dataclass
class InternalsLayerResult:
    status: str
    score: int | None
    verdict: str
    vix_price: float | None = None
    vix_trend: str | None = None
    breadth_signal: str | None = None
    participation: str | None = None
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)


def _vix_level_score(vix_price: float, params: MacroParameters) -> float:
    if vix_price >= params.vix_high:
        return float(params.vix_extreme_score)
    if vix_price >= params.vix_elevated:
        return float(params.vix_high_score)
    if vix_price >= params.vix_normal:
        return float(params.vix_elevated_score)
    if vix_price >= params.vix_low:
        return float(params.vix_normal_score)
    return float(params.vix_low_score)


class InternalsAnalyzer:
    def analyze(
        self,
        vix_snapshot: Snapshot | None,
        spy_snapshot: Snapshot | None,
        qqq_snapshot: Snapshot | None,
        params: MacroParameters,
    ) -> InternalsLayerResult:
        if vix_snapshot and vix_snapshot.last_trade_price:
            vix_price = float(vix_snapshot.last_trade_price)
            vix_score = _vix_level_score(vix_price, params)
            chg = float(vix_snapshot.change_percent) if vix_snapshot.change_percent is not None else 0.0
            if chg < -params.vix_trend_threshold_pct:
                vix_score = _clamp(vix_score + params.vix_falling_bonus, 0.0, 100.0)
            elif chg > params.vix_trend_threshold_pct:
                vix_score = _clamp(vix_score - params.vix_rising_penalty, 0.0, 100.0)
            vix_trend = vix_direction_from_change(vix_snapshot.change_percent)
        else:
            vix_price = None
            vix_score = 50.0
            vix_trend = None

        spy_pct = float(spy_snapshot.change_percent) if spy_snapshot and spy_snapshot.change_percent is not None else None
        if spy_pct is None:
            breadth_score = 50.0
            breadth_signal = "unknown"
        else:
            if spy_pct > 0.5:
                breadth_score = 75.0
                breadth_signal = "strong_up"
            elif spy_pct > 0:
                breadth_score = 60.0
                breadth_signal = "up"
            elif spy_pct > -0.5:
                breadth_score = 45.0
                breadth_signal = "flat"
            else:
                breadth_score = 30.0
                breadth_signal = "down"

        spy_p = spy_snapshot.change_percent if spy_snapshot else None
        qqq_p = qqq_snapshot.change_percent if qqq_snapshot else None
        if spy_p is None or qqq_p is None:
            participation_score = 50.0
            participation = "unknown"
        else:
            sp = float(spy_p)
            qp = float(qqq_p)
            if sp > 0 and qp > 0:
                participation_score = 75.0
                participation = "broad_up"
            elif sp < 0 and qp < 0:
                participation_score = 25.0
                participation = "broad_down"
            else:
                participation_score = 50.0
                participation = "mixed"

        final = vix_score * 0.40 + breadth_score * 0.35 + participation_score * 0.25
        score_i = int(round(_clamp(final, 0.0, 100.0)))

        if score_i >= 60:
            verdict = "bullish"
        elif score_i <= 35:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips: list[str] = []
        if vix_price is not None:
            falling = vix_trend == "falling"
            chips.append(f"VIX: {'Lower' if falling else 'Higher'} ({vix_price:.1f})")
        chips.append(f"Breadth {breadth_signal or 'n/a'}")
        chips.append(f"Participation {participation or 'n/a'}")

        return InternalsLayerResult(
            status="available",
            score=score_i,
            verdict=verdict,
            vix_price=vix_price,
            vix_trend=vix_trend,
            breadth_signal=breadth_signal,
            participation=participation,
            reasoning=(
                f"Internals {score_i}/100 — VIX component {vix_score:.0f}, "
                f"breadth {breadth_score:.0f}, participation {participation_score:.0f}."
            ),
            chips=chips,
        )
