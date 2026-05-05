"""Layer 3 — SPY/QQQ momentum, VIX volatility, economic calendar risk."""

from __future__ import annotations

from dataclasses import dataclass, field
from stocvest.config.signal_parameters import MacroParameters
from stocvest.data.models import EconomicCalendarEvent, Snapshot
from stocvest.signals.morning_brief import infer_regime, vix_direction_from_change


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


@dataclass
class MacroLayerResult:
    status: str
    score: int | None
    verdict: str
    market_regime: str = "neutral"
    spy_day_pct: float | None = None
    qqq_day_pct: float | None = None
    vix_price: float | None = None
    vix_trend: str | None = None
    event_today: bool = False
    event_name: str | None = None
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)


_MAJOR = (
    "fomc",
    "federal reserve",
    "fed decision",
    "cpi",
    "consumer price",
    "inflation",
    "nfp",
    "non-farm payroll",
    "jobs report",
    "gdp",
    "pce",
    "retail sales",
)


class MacroAnalyzer:
    def analyze(
        self,
        spy_snapshot: Snapshot | None,
        qqq_snapshot: Snapshot | None,
        vix_snapshot: Snapshot | None,
        economic_events: list[EconomicCalendarEvent],
        params: MacroParameters,
        *,
        events_lookback_days: int = 1,
    ) -> MacroLayerResult:
        spy_pct = float(spy_snapshot.change_percent) if spy_snapshot and spy_snapshot.change_percent is not None else None
        qqq_pct = float(qqq_snapshot.change_percent) if qqq_snapshot and qqq_snapshot.change_percent is not None else None

        if spy_pct is None and qqq_pct is None:
            return MacroLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="SPY/QQQ snapshots unavailable for macro momentum.",
                chips=[],
            )

        spy_s = _clamp(50.0 + (spy_pct or 0.0) * 10.0, 0.0, 100.0)
        qqq_s = _clamp(50.0 + (qqq_pct or 0.0) * 10.0, 0.0, 100.0)
        momentum_score = (spy_s + qqq_s) / 2.0

        vix_price = float(vix_snapshot.last_trade_price) if vix_snapshot and vix_snapshot.last_trade_price else None
        vix_chg = float(vix_snapshot.change_percent) if vix_snapshot and vix_snapshot.change_percent is not None else None

        if vix_price is None:
            vol_score = 50.0
            vix_trend = None
        else:
            if vix_price >= params.vix_high:
                vol_score = float(params.vix_extreme_score)
            elif vix_price >= params.vix_elevated:
                vol_score = float(params.vix_high_score)
            elif vix_price >= params.vix_normal:
                vol_score = float(params.vix_elevated_score)
            elif vix_price >= params.vix_low:
                vol_score = float(params.vix_normal_score)
            else:
                vol_score = float(params.vix_low_score)
            vix_trend = vix_direction_from_change(vix_snapshot.change_percent if vix_snapshot else None)
            if vix_chg is not None:
                if vix_chg < -params.vix_trend_threshold_pct:
                    vol_score = _clamp(vol_score + params.vix_falling_bonus, 0.0, 100.0)
                elif vix_chg > params.vix_trend_threshold_pct:
                    vol_score = _clamp(vol_score - params.vix_rising_penalty, 0.0, 100.0)

        event_today = False
        event_name: str | None = None
        event_score = float(params.no_event_score)
        for ev in economic_events:
            nm = f"{ev.event_name}".lower()
            if any(k in nm for k in _MAJOR):
                event_today = True
                event_name = ev.event_name
                event_score = float(params.event_today_score)
                break

        macro_score_f = (
            momentum_score * params.momentum_weight
            + vol_score * params.volatility_weight
            + event_score * params.event_weight
        )
        macro_score = int(round(_clamp(macro_score_f, 0.0, 100.0)))

        vix_for_regime = vix_price if vix_price is not None else 18.0
        label = infer_regime(spy_pct, qqq_pct, vix_for_regime)
        if vix_price is not None and vix_price > params.vix_high:
            market_regime = "avoid"
        elif macro_score >= 60:
            market_regime = "risk_on"
        elif macro_score <= 40:
            market_regime = "risk_off"
        else:
            market_regime = "neutral"

        if macro_score >= params.bullish_threshold:
            verdict = "bullish"
        elif macro_score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips = [f"Label {label}"]
        if spy_pct is not None:
            chips.append(f"SPY {spy_pct:+.2f}%")
        if qqq_pct is not None:
            chips.append(f"QQQ {qqq_pct:+.2f}%")
        if vix_price is not None:
            chips.append(f"VIX {vix_price:.1f}")
        if events_lookback_days > 1:
            chips.append(f"Calendar {events_lookback_days}d")

        reason = (
            f"Macro {macro_score}/100 — momentum {momentum_score:.0f}, "
            f"volatility {vol_score:.0f}, event-risk {event_score:.0f}."
        )
        if events_lookback_days > 1:
            reason += f" Economic window: {events_lookback_days} days."

        return MacroLayerResult(
            status="available",
            score=macro_score,
            verdict=verdict,
            market_regime=market_regime,
            spy_day_pct=spy_pct,
            qqq_day_pct=qqq_pct,
            vix_price=vix_price,
            vix_trend=vix_trend,
            event_today=event_today,
            event_name=event_name,
            reasoning=reason,
            chips=chips,
        )
