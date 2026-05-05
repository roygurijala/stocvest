"""Swing / daily-bar technical layer (SMA, RSI, MACD, base, volume regime) — separate from intraday :mod:`technical_analyzer`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from stocvest.config.signal_parameters import SwingTechnicalParameters
from stocvest.data.models import Bar, Snapshot
from stocvest.signals.technical_analyzer import _calculate_ema, _calculate_rsi


def _sma(closes: list[float], period: int) -> Optional[float]:
    if len(closes) < period or period <= 0:
        return None
    return round(sum(closes[-period:]) / period, 4)


def _daily_rsi(closes: list[float], period: int = 14) -> Optional[float]:
    return _calculate_rsi(closes, period)


def _macd_series(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float], Optional[float]]:
    """
    Returns (macd_now, signal_now, histogram_now, macd_prev, signal_prev) using the last two bars
    of the MACD / signal series, or Nones if insufficient data.
    """
    n = len(closes)
    if n < slow + signal + 2:
        return None, None, None, None, None

    macd_line: list[float] = []
    for i in range(slow - 1, n):
        sub = closes[: i + 1]
        e12 = _calculate_ema(sub, fast)
        e26 = _calculate_ema(sub, slow)
        if e12 is None or e26 is None:
            continue
        macd_line.append(float(e12) - float(e26))

    if len(macd_line) < signal + 2:
        return None, None, None, None, None

    def _ema_seq(vals: list[float], period: int) -> list[float]:
        mult = 2.0 / (period + 1)
        ema = sum(vals[:period]) / period
        out = [ema]
        for x in vals[period:]:
            ema = (x - ema) * mult + ema
            out.append(ema)
        return out

    sig_seq = _ema_seq(macd_line, signal)
    if len(sig_seq) < 2:
        return None, None, None, None, None

    m_now = macd_line[-1]
    m_prev = macd_line[-2]
    s_now = sig_seq[-1]
    s_prev = sig_seq[-2]
    h_now = m_now - s_now
    return float(m_now), float(s_now), float(h_now), float(m_prev), float(s_prev)


def _higher_highs_lows(bars: list[Bar], lookback: int = 20) -> bool:
    if len(bars) < lookback:
        return False
    chunk = bars[-lookback:]
    n = len(chunk) // 3
    if n < 2:
        return False
    p1 = chunk[:n]
    p2 = chunk[n : 2 * n]
    p3 = chunk[2 * n : 3 * n]
    if not p1 or not p2 or not p3:
        return False

    def _hh(pl: list[Bar]) -> float:
        return max(b.high for b in pl)

    def _ll(pl: list[Bar]) -> float:
        return min(b.low for b in pl)

    h1, h2, h3 = _hh(p1), _hh(p2), _hh(p3)
    l1, l2, l3 = _ll(p1), _ll(p2), _ll(p3)
    return h1 < h2 < h3 and l1 < l2 < l3


def _base_formation(bars: list[Bar], params: SwingTechnicalParameters) -> tuple[bool, int, float]:
    if len(bars) < params.base_min_days:
        return False, 0, 0.0
    for w in range(min(params.base_max_days, len(bars)), params.base_min_days - 1, -1):
        chunk = bars[-w:]
        hi = max(b.high for b in chunk)
        lo = min(b.low for b in chunk)
        if lo <= 0:
            continue
        rng = (hi - lo) / lo
        if rng <= params.base_max_range_pct:
            return True, w, float(rng)
    return False, 0, 0.0


def _volume_pattern(bars: list[Bar], params: SwingTechnicalParameters) -> tuple[str, int, int]:
    lb = min(params.volume_lookback_days, len(bars))
    if lb < 5:
        return "neutral", 0, 0
    tail = bars[-lb:]
    closes = [b.close for b in tail]
    vols = [b.volume for b in tail]
    avg_vol = sum(vols) / len(vols) if vols else 0.0
    acc = dist = 0
    for b in tail:
        if avg_vol <= 0:
            continue
        if b.close > b.open and b.volume > avg_vol:
            acc += 1
        elif b.close < b.open and b.volume > avg_vol:
            dist += 1
    if acc > dist + 2:
        return "accumulation", acc, dist
    if dist > acc + 2:
        return "distribution", acc, dist
    return "neutral", acc, dist


@dataclass
class SwingTechnicalLayerResult:
    status: str
    score: Optional[int]
    verdict: str
    sma50: Optional[float] = None
    sma200: Optional[float] = None
    daily_rsi: Optional[float] = None
    golden_cross: bool = False
    macd_above_signal: bool = False
    higher_highs_lows: bool = False
    in_base: bool = False
    base_days: int = 0
    base_range_pct: float = 0.0
    volume_regime: str = "neutral"
    near_range_high: bool = False
    bars_analyzed: int = 0
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)
    confluence_pattern: str = "swing_composite"


class SwingTechnicalAnalyzer:
    def analyze(
        self,
        symbol: str,
        daily_bars: list[Bar],
        snapshot: Snapshot,
        params: SwingTechnicalParameters,
    ) -> SwingTechnicalLayerResult:
        _ = symbol
        if len(daily_bars) < 60:
            return SwingTechnicalLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                reasoning="Insufficient daily history for swing technicals (need at least 60 sessions).",
                chips=[],
            )

        bars = sorted(daily_bars, key=lambda b: b.timestamp)
        closes = [b.close for b in bars]
        last = closes[-1]

        sma50 = _sma(closes, params.sma_fast_period)
        sma200 = _sma(closes, params.sma_slow_period)
        rsi = _daily_rsi(closes, params.rsi_period)

        m_now, s_now, _hist_now, m_prev, s_prev = _macd_series(closes)
        macd_above = m_now is not None and s_now is not None and m_now > s_now
        macd_bull_cross = (
            m_now is not None
            and s_now is not None
            and m_prev is not None
            and s_prev is not None
            and m_prev <= s_prev
            and m_now > s_now
        )

        gc = bool(sma50 and sma200 and sma50 > sma200)
        dc = bool(sma50 and sma200 and sma50 < sma200)

        hh = _higher_highs_lows(bars, lookback=20)
        in_base, bd, brp = _base_formation(bars, params)
        vol_regime, _, _ = _volume_pattern(bars, params)

        range_high = max(b.high for b in bars)
        near_high = range_high > 0 and last >= range_high * 0.95

        score = 50
        if sma50 is not None:
            score += params.above_sma50_score if last > sma50 else -params.above_sma50_score
        if sma200 is not None:
            score += params.above_sma200_score if last > sma200 else -params.above_sma200_score
        if rsi is not None:
            score += params.rsi_score_delta if rsi >= params.rsi_bullish_zone else -params.rsi_score_delta
        score += params.higher_highs_lows_score if hh else -params.higher_highs_lows_score
        if vol_regime == "accumulation":
            score += params.volume_accumulation_score
        elif vol_regime == "distribution":
            score -= params.volume_accumulation_score
        if near_high:
            score += params.near_52w_high_score
        if in_base:
            score += params.base_formation_score

        score = int(max(0, min(100, score)))

        if score >= params.bullish_threshold:
            verdict = "bullish"
        elif score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips: list[str] = []
        if sma50 is not None:
            chips.append("Above SMA50" if last > sma50 else "Below SMA50")
        if sma200 is not None:
            chips.append("Above SMA200" if last > sma200 else "Below SMA200")
        if rsi is not None:
            chips.append(f"RSI {rsi:.0f}")
        if gc:
            chips.append("Golden Cross")
        elif dc:
            chips.append("Death Cross")
        if hh:
            chips.append("HH/HL Uptrend")
        if in_base:
            chips.append(f"Base {bd}d")
        if vol_regime == "accumulation":
            chips.append("Accumulating")
        elif vol_regime == "distribution":
            chips.append("Distributing")
        else:
            chips.append("Volume neutral")
        if near_high:
            chips.append("Near 52W High")

        parts: list[str] = []
        if sma50 is not None and sma200 is not None:
            parts.append(f"Price vs SMA50 (${sma50:.2f}) and SMA200 (${sma200:.2f}) — {'uptrend' if gc else 'mixed' if not dc else 'downtrend'} structure.")
        if rsi is not None:
            parts.append(f"Daily RSI {rsi:.0f}.")
        if in_base:
            parts.append(f"Base formation ~{bd}d ({brp * 100:.1f}% range).")
        if m_now is not None and s_now is not None:
            parts.append(f"MACD {m_now:.3f} vs signal {s_now:.3f} ({'above' if macd_above else 'below'}).")
        reasoning = " ".join(parts) if parts else "Daily swing technical snapshot complete."

        cp = "golden_cross" if gc else "swing_composite"
        if macd_bull_cross:
            cp = "macd_bull_cross"

        return SwingTechnicalLayerResult(
            status="available",
            score=score,
            verdict=verdict,
            sma50=sma50,
            sma200=sma200,
            daily_rsi=rsi,
            golden_cross=gc,
            macd_above_signal=bool(macd_above),
            higher_highs_lows=hh,
            in_base=in_base,
            base_days=bd,
            base_range_pct=brp,
            volume_regime=vol_regime,
            near_range_high=near_high,
            bars_analyzed=len(bars),
            reasoning=reasoning,
            chips=chips,
            confluence_pattern=cp,
        )
