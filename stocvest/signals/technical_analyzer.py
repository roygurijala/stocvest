"""Layer 1 — intraday technical stack (RSI, VWAP, EMA9/20, ORB, volume ratio, ATR)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from zoneinfo import ZoneInfo

from stocvest.config.signal_parameters import TechnicalParameters
from stocvest.data.models import Bar, Snapshot

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")


@dataclass
class TechnicalLayerResult:
    status: str
    score: Optional[int]
    verdict: str
    rsi: Optional[float] = None
    vwap_from_bars: Optional[float] = None
    ema9: Optional[float] = None
    ema20: Optional[float] = None
    atr: Optional[float] = None
    price_vs_vwap: Optional[str] = None
    ema_alignment: Optional[str] = None
    ema_crossed_recently: Optional[str] = None
    orb_signal: Optional[str] = None
    orb_high: Optional[float] = None
    orb_low: Optional[float] = None
    orb_qualified: bool = False
    volume_vs_adv: Optional[float] = None
    volume_surge: bool = False
    adv_available: bool = False
    prev_day_high: Optional[float] = None
    prev_day_low: Optional[float] = None
    bars_analyzed: int = 0
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)
    error: Optional[str] = None


def _calculate_rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1 + rs)), 2)


def _calculate_vwap(bars: list[Bar]) -> Optional[float]:
    total_pv = 0.0
    total_v = 0.0
    for bar in bars:
        if not bar.volume or bar.volume <= 0:
            continue
        typical = (bar.high + bar.low + bar.close) / 3
        total_pv += typical * bar.volume
        total_v += bar.volume
    if total_v == 0:
        return None
    return round(total_pv / total_v, 4)


def _calculate_ema(closes: list[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    mult = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for c in closes[period:]:
        ema = (c - ema) * mult + ema
    return round(ema, 4)


def _calculate_atr(bars: list[Bar], period: int = 14) -> Optional[float]:
    if len(bars) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(bars)):
        tr = max(
            bars[i].high - bars[i].low,
            abs(bars[i].high - bars[i - 1].close),
            abs(bars[i].low - bars[i - 1].close),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return round(atr, 4)


def _detect_ema_crossover(closes: list[float], ema9: float, lookback: int = 3) -> Optional[str]:
    if len(closes) < lookback + 1:
        return None
    prev_close = closes[-(lookback + 1)]
    curr_close = closes[-1]
    if prev_close < ema9 and curr_close >= ema9:
        return "up"
    if prev_close > ema9 and curr_close <= ema9:
        return "down"
    return None


def _detect_orb(bars: list[Bar], params: TechnicalParameters) -> tuple[str, Optional[float], Optional[float]]:
    min_bars = params.orb_period_minutes
    if len(bars) < min_bars:
        return "insufficient", None, None

    orb_high = max(bar.high for bar in bars[:min_bars])
    orb_low = min(bar.low for bar in bars[:min_bars])
    if orb_high is None or orb_low is None:
        return "insufficient", None, None

    last_bar = bars[-1]
    try:
        bar_et = last_bar.timestamp.astimezone(_ET)
        if bar_et.hour >= params.orb_expiry_hour_et:
            return "expired", float(orb_high), float(orb_low)
    except Exception as exc:
        log.warning("ORB timestamp parse: %s", exc)

    price = float(bars[-1].close)
    buf = float(params.orb_buffer_pct)
    if price > float(orb_high) * (1 + buf):
        return "breakout_long", float(orb_high), float(orb_low)
    if price < float(orb_low) * (1 - buf):
        return "breakout_short", float(orb_high), float(orb_low)
    return "inside_range", float(orb_high), float(orb_low)


def _compute_volume_ratio(
    bars: list[Bar],
    params: TechnicalParameters,
    adv: float | None,
) -> tuple[float, bool]:
    if adv is not None and adv > 0:
        last_v = float(bars[-1].volume)
        ratio = last_v / adv
        return ratio, True
    lb = min(params.volume_lookback_bars, len(bars) - 1)
    if lb <= 0:
        return 1.0, False
    recent_avg = sum(float(bar.volume) for bar in bars[-lb:]) / lb
    if recent_avg <= 0:
        return 1.0, False
    ratio = float(bars[-1].volume) / recent_avg
    return ratio, False


class TechnicalAnalyzer:
    MIN_BARS = 5

    def analyze(
        self,
        symbol: str,
        bars: list[Bar],
        snapshot: Snapshot,
        params: TechnicalParameters,
        *,
        adv: float | None = None,
    ) -> TechnicalLayerResult:
        _ = symbol
        if not bars or len(bars) < self.MIN_BARS:
            return TechnicalLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                bars_analyzed=len(bars) if bars else 0,
                reasoning="Insufficient bar data. Market may be closed.",
                error="insufficient_bars",
            )

        closes = [float(bar.close) for bar in bars if bar.close and bar.close > 0]
        if not closes:
            return TechnicalLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                bars_analyzed=len(bars),
                error="no_valid_closes",
            )

        price = closes[-1]

        rsi = _calculate_rsi(closes, params.rsi_period)
        vwap = _calculate_vwap(bars)
        ema9 = _calculate_ema(closes, params.ema_fast_period)
        ema20 = _calculate_ema(closes, params.ema_slow_period)
        atr = _calculate_atr(bars, params.atr_period)
        orb_signal, orb_high, orb_low = _detect_orb(bars, params)
        volume_ratio, adv_available = _compute_volume_ratio(bars, params, adv)
        volume_surge = volume_ratio >= params.volume_surge_multiplier

        ema_alignment: Optional[str] = None
        ema_crossed: Optional[str] = None
        if ema9 is not None and ema20 is not None:
            if price > ema9 and ema9 > ema20:
                ema_alignment = "bullish"
                ema_crossed = _detect_ema_crossover(closes, ema9)
            elif price < ema9 and ema9 < ema20:
                ema_alignment = "bearish"
                ema_crossed = _detect_ema_crossover(closes, ema9)
            else:
                ema_alignment = "mixed"

        orb_qualified = False
        if atr and orb_signal in ("breakout_long", "breakout_short") and orb_high is not None and orb_low is not None:
            if orb_signal == "breakout_long":
                size = price - orb_high
            else:
                size = orb_low - price
            orb_qualified = size > (params.orb_atr_qualification_ratio * atr)

        prev_day_high: Optional[float] = None
        prev_day_low: Optional[float] = None

        base_score = 50.0

        if vwap is not None:
            delta = float(params.vwap_score_delta)
            base_score += delta if price > vwap else -delta

        if ema_alignment == "bullish":
            base_score += params.ema_score_delta
            if ema_crossed == "up":
                base_score += params.ema_crossover_bonus
        elif ema_alignment == "bearish":
            base_score -= params.ema_score_delta
            if ema_crossed == "down":
                base_score -= params.ema_crossover_bonus

        if orb_signal == "breakout_long":
            applied = params.orb_score_delta if orb_qualified else params.orb_score_delta // 2
            base_score += applied
        elif orb_signal == "breakout_short":
            applied = params.orb_score_delta if orb_qualified else params.orb_score_delta // 2
            base_score -= applied

        if rsi is not None:
            if rsi > params.rsi_overbought:
                base_score -= params.rsi_moderate_delta
            elif rsi >= params.rsi_bullish_zone:
                base_score += params.rsi_strong_delta
            elif rsi <= params.rsi_oversold:
                base_score += params.rsi_moderate_delta
            elif rsi <= params.rsi_bearish_zone:
                base_score -= params.rsi_strong_delta

        if volume_surge:
            direction = 1 if base_score > 50 else -1
            base_score += direction * params.volume_amplifier

        final_score = int(max(0, min(100, round(base_score))))

        if final_score >= params.bullish_threshold:
            verdict = "bullish"
        elif final_score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        parts: list[str] = []
        if vwap:
            pos = "above" if price > vwap else "below"
            parts.append(f"Price {pos} VWAP (${vwap:.2f})")
        if ema_alignment == "bullish" and ema9 is not None and ema20 is not None:
            parts.append(f"EMA9({ema9:.2f}) > EMA20({ema20:.2f}) — trend stack bullish")
        elif ema_alignment == "bearish" and ema9 is not None and ema20 is not None:
            parts.append(f"EMA9({ema9:.2f}) < EMA20({ema20:.2f}) — trend stack bearish")
        elif ema_alignment == "mixed":
            parts.append("EMA9/EMA20 mixed — no clear stack")
        if orb_signal == "breakout_long" and orb_high is not None:
            q = "confirmed" if orb_qualified else "weak"
            parts.append(f"ORB breakout above ${orb_high:.2f} ({q})")
        elif orb_signal == "breakout_short" and orb_low is not None:
            q = "confirmed" if orb_qualified else "weak"
            parts.append(f"ORB breakdown below ${orb_low:.2f} ({q})")
        elif orb_signal == "expired":
            parts.append("ORB window closed (after 10 AM ET)")
        if rsi is not None:
            if rsi > params.rsi_overbought:
                parts.append(f"RSI {rsi:.0f} — overbought, reducing confidence")
            elif rsi < params.rsi_oversold:
                parts.append(f"RSI {rsi:.0f} — oversold bounce context")
            else:
                parts.append(f"RSI {rsi:.0f}")
        if volume_surge:
            parts.append(f"Volume {volume_ratio:.1f}x recent average — surge")
        reasoning = ". ".join(parts[:3]) or f"Technical score {final_score}/100 from {len(bars)} bars"

        chips: list[str] = []
        if rsi is not None:
            chips.append(f"RSI {rsi:.0f}")
        if vwap:
            chips.append("VWAP Above" if price > vwap else "VWAP Below")
        if orb_signal == "breakout_long":
            chips.append("ORB Breakout Long")
        elif orb_signal == "breakout_short":
            chips.append("ORB Breakout Short")
        elif orb_signal == "expired":
            chips.append("ORB Expired")
        if ema_alignment == "bullish":
            chips.append("EMA Stack Bullish")
        elif ema_alignment == "bearish":
            chips.append("EMA Stack Bearish")
        if volume_surge:
            chips.append(f"Vol {volume_ratio:.1f}x")

        return TechnicalLayerResult(
            status="available",
            score=final_score,
            verdict=verdict,
            rsi=rsi,
            vwap_from_bars=vwap,
            ema9=ema9,
            ema20=ema20,
            atr=atr,
            price_vs_vwap=("above" if vwap and price > vwap else "below" if vwap else None),
            ema_alignment=ema_alignment,
            ema_crossed_recently=ema_crossed,
            orb_signal=orb_signal,
            orb_high=orb_high,
            orb_low=orb_low,
            orb_qualified=orb_qualified,
            volume_vs_adv=volume_ratio,
            volume_surge=volume_surge,
            adv_available=adv_available,
            prev_day_high=prev_day_high,
            prev_day_low=prev_day_low,
            bars_analyzed=len(bars),
            reasoning=reasoning,
            chips=chips,
        )
