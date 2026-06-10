"""Swing / daily-bar technical layer (SMA, RSI, MACD, base, volume regime) — separate from intraday :mod:`technical_analyzer`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from stocvest.config.signal_parameters import SwingTechnicalParameters
from stocvest.data.models import Bar, Snapshot
from stocvest.signals.indicator_scope import finalize_swing_technical_chips, sanitize_swing_reasoning_text
from stocvest.signals.technical_analyzer import _calculate_ema, _calculate_rsi


def _sma(closes: list[float], period: int) -> Optional[float]:
    if len(closes) < period or period <= 0:
        return None
    return round(sum(closes[-period:]) / period, 4)


def _daily_rsi(closes: list[float], period: int = 14) -> Optional[float]:
    return _calculate_rsi(closes, period)


def _ema_incremental(values: list[float], period: int) -> list[float]:
    """Single-pass incremental EMA over a full sequence.

    Seeds from the SMA of the first ``period`` values, then streams the rest.
    Returns a list aligned to ``values[period - 1:]`` (length = len(values) - period + 1).
    """
    if len(values) < period:
        return []
    mult = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    out = [ema]
    for x in values[period:]:
        ema = (x - ema) * mult + ema
        out.append(ema)
    return out


def _macd_series(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float], Optional[float]]:
    """
    Returns (macd_now, signal_now, histogram_now, macd_prev, signal_prev) using the last two bars
    of the MACD / signal series, or Nones if insufficient data.

    Uses a single-pass incremental EMA (O(n)) instead of recomputing the full EMA
    from scratch for each bar (previously O(n²)).
    """
    n = len(closes)
    if n < slow + signal + 2:
        return None, None, None, None, None

    ema_fast = _ema_incremental(closes, fast)
    ema_slow = _ema_incremental(closes, slow)

    # ema_fast is aligned to closes[fast-1:], ema_slow to closes[slow-1:].
    # MACD = ema_fast - ema_slow, aligned to closes[slow-1:] (the shorter series).
    offset = slow - fast  # ema_fast is longer by this many leading values
    if offset < 0 or len(ema_slow) == 0:
        return None, None, None, None, None
    macd_line = [ema_fast[offset + i] - ema_slow[i] for i in range(len(ema_slow))]

    if len(macd_line) < signal + 2:
        return None, None, None, None, None

    sig_seq = _ema_incremental(macd_line, signal)
    if len(sig_seq) < 2:
        return None, None, None, None, None

    m_now = macd_line[-1]
    m_prev = macd_line[-2]
    s_now = sig_seq[-1]
    s_prev = sig_seq[-2]
    h_now = m_now - s_now
    return float(m_now), float(s_now), float(h_now), float(m_prev), float(s_prev)


def _thirds_pattern(bars: list[Bar], lookback: int = 20) -> tuple[list[Bar], list[Bar], list[Bar]] | None:
    if len(bars) < lookback:
        return None
    chunk = bars[-lookback:]
    n = len(chunk) // 3
    if n < 2:
        return None
    p1 = chunk[:n]
    p2 = chunk[n : 2 * n]
    p3 = chunk[2 * n : 3 * n]
    if not p1 or not p2 or not p3:
        return None
    return p1, p2, p3


def _higher_highs_lows(bars: list[Bar], lookback: int = 20) -> bool:
    parts = _thirds_pattern(bars, lookback)
    if parts is None:
        return False
    p1, p2, p3 = parts

    def _hh(pl: list[Bar]) -> float:
        return max(b.high for b in pl)

    def _ll(pl: list[Bar]) -> float:
        return min(b.low for b in pl)

    h1, h2, h3 = _hh(p1), _hh(p2), _hh(p3)
    l1, l2, l3 = _ll(p1), _ll(p2), _ll(p3)
    return h1 < h2 < h3 and l1 < l2 < l3


def _lower_highs_lows(bars: list[Bar], lookback: int = 20) -> bool:
    parts = _thirds_pattern(bars, lookback)
    if parts is None:
        return False
    p1, p2, p3 = parts

    def _hh(pl: list[Bar]) -> float:
        return max(b.high for b in pl)

    def _ll(pl: list[Bar]) -> float:
        return min(b.low for b in pl)

    h1, h2, h3 = _hh(p1), _hh(p2), _hh(p3)
    l1, l2, l3 = _ll(p1), _ll(p2), _ll(p3)
    return h1 > h2 > h3 and l1 > l2 > l3


def _rate_of_change(closes: list[float], sessions: int) -> Optional[float]:
    if sessions <= 0 or len(closes) <= sessions:
        return None
    start = closes[-(sessions + 1)]
    end = closes[-1]
    if start <= 0:
        return None
    return (end - start) / start


def _scaled_extension_penalty(
    pct_above: float,
    threshold_pct: float,
    base_penalty: int,
    extra_per_10_pct: int,
    cap: int,
) -> int:
    if pct_above < threshold_pct or threshold_pct <= 0:
        return 0
    excess = pct_above - threshold_pct
    steps = int(excess // 10.0) + 1
    return min(cap, base_penalty + steps * extra_per_10_pct)


def _recent_range_high(bars: list[Bar], lookback: int) -> Optional[float]:
    if not bars or lookback <= 0:
        return None
    chunk = bars[-lookback:] if len(bars) >= lookback else bars
    return max(float(b.high) for b in chunk)


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


def _rsi_momentum_phase(rsi: Optional[float], params: SwingTechnicalParameters) -> Optional[str]:
    """RSI phase for MACD copy: building (<60), strong (60–70), extended (≥70)."""
    if rsi is None:
        return None
    if rsi >= params.rsi_overbought:
        return "extended"
    if rsi >= params.rsi_momentum_building_max:
        return "strong"
    return "building"


def _macd_momentum_clause(
    *,
    phase: Optional[str],
    macd_above: bool,
    m_now: float,
    s_now: float,
) -> str:
    line_vs_signal = "MACD line above its signal" if macd_above else "MACD line below its signal"
    if m_now < 0 and s_now < 0:
        return (
            f"MACD {m_now:.3f} vs signal {s_now:.3f} ({line_vs_signal}; "
            "both below zero — momentum remains weak)."
        )
    if m_now > 0 and s_now > 0 and macd_above:
        if phase == "extended":
            tail = "both above zero — momentum strong but extended."
        elif phase == "strong":
            tail = "both above zero — momentum strong."
        else:
            tail = "both above zero — momentum building."
        return f"MACD {m_now:.3f} vs signal {s_now:.3f} ({line_vs_signal}; {tail}"
    return f"MACD {m_now:.3f} vs signal {s_now:.3f} ({line_vs_signal})."


def _extension_penalty(
    last: float,
    anchor: Optional[float],
    threshold_pct: float,
    penalty: int,
) -> int:
    # DEPRECATED: returns a flat penalty regardless of how far extended the
    # price is. Use _scaled_extension_penalty instead, which correctly
    # increases the penalty for larger extensions beyond the threshold.
    # This function is not called by SwingTechnicalAnalyzer.analyze; it is
    # kept only to avoid breaking any external callers.
    if anchor is None or anchor <= 0 or threshold_pct <= 0:
        return 0
    pct_above = (last - anchor) / anchor * 100.0
    if pct_above >= threshold_pct:
        return penalty
    return 0


@dataclass
class SwingTechnicalLayerResult:
    status: str
    score: Optional[int]
    verdict: str
    sma20: Optional[float] = None
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

        sma20 = _sma(closes, 20)
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

        recent_high = _recent_range_high(bars, params.recent_high_lookback_sessions)
        pct_from_high: Optional[float] = None
        if recent_high and recent_high > 0:
            pct_from_high = (last - recent_high) / recent_high * 100.0
        near_high = pct_from_high is not None and pct_from_high >= -5.0

        roc = _rate_of_change(closes, params.roc_lookback_sessions)
        lh = _lower_highs_lows(bars, lookback=20)
        h_prev = (m_prev - s_prev) if m_prev is not None and s_prev is not None else None

        score = 50

        # SMA20 — primary swing anchor
        if sma20 is not None and sma20 > 0:
            ext20 = (last - sma20) / sma20 * 100.0
            if last > sma20:
                if ext20 >= params.sma20_extended_pct:
                    score -= params.sma20_extended_penalty
                else:
                    score += params.above_sma20_score
            else:
                score -= params.below_sma20_score

        # SMA50 / SMA200 — structural context (lighter than before)
        if sma50 is not None:
            score += params.above_sma50_score if last > sma50 else -params.above_sma50_score
            if sma50 > 0:
                ext50 = (last - sma50) / sma50 * 100.0
                score -= _scaled_extension_penalty(
                    ext50,
                    params.extension_above_sma50_pct,
                    params.extension_above_sma50_penalty,
                    params.extension_extra_per_10_pct,
                    params.extension_penalty_cap,
                )
        if sma200 is not None:
            score += params.above_sma200_score if last > sma200 else -params.above_sma200_score
            if sma200 > 0:
                ext200 = (last - sma200) / sma200 * 100.0
                score -= _scaled_extension_penalty(
                    ext200,
                    params.extension_above_sma200_pct,
                    params.extension_above_sma200_penalty,
                    params.extension_extra_per_10_pct,
                    params.extension_penalty_cap,
                )

        # Recent momentum — dominant for swing (breakdown from ATH, etc.)
        if roc is not None:
            roc_pct = roc * 100.0
            if roc_pct <= params.roc_strong_down_pct:
                score -= params.roc_strong_score
            elif roc_pct <= params.roc_moderate_down_pct:
                score -= params.roc_moderate_score
            elif roc_pct >= params.roc_strong_up_pct:
                score += params.roc_strong_score
            elif roc_pct >= params.roc_moderate_up_pct:
                score += params.roc_moderate_score

        if pct_from_high is not None:
            if pct_from_high <= params.pct_from_high_strong_break_pct:
                score -= params.pct_from_high_strong_penalty
            elif pct_from_high <= params.pct_from_high_moderate_break_pct:
                score -= params.pct_from_high_moderate_penalty

        if lh:
            score -= params.lower_highs_lows_score
        elif hh:
            score += params.higher_highs_lows_score

        if _hist_now is not None:
            if _hist_now < 0:
                score -= params.macd_histogram_negative_penalty
            elif macd_above:
                score += params.macd_histogram_positive_score
            if h_prev is not None and _hist_now < h_prev:
                score -= params.macd_histogram_fading_penalty

        sma50_extended = (
            sma50 is not None
            and sma50 > 0
            and (last - sma50) / sma50 * 100.0 >= params.extension_above_sma50_pct
        )
        if rsi is not None:
            if rsi >= params.rsi_overbought:
                score -= params.rsi_overbought_penalty
            elif sma50_extended and rsi >= params.rsi_bullish_zone:
                score -= params.rsi_exhaustion_extended_penalty
            elif roc is not None and roc * 100.0 <= params.roc_moderate_down_pct and rsi < 50:
                score -= max(5, params.rsi_score_delta // 2)
            elif rsi >= params.rsi_bullish_zone and (roc is None or roc > 0):
                score += params.rsi_score_delta
            elif rsi <= params.rsi_oversold:
                score += max(5, params.rsi_score_delta // 2)
            elif rsi <= params.rsi_bullish_zone:
                score -= max(3, params.rsi_score_delta // 3)

        if vol_regime == "accumulation":
            score += params.volume_accumulation_score
        elif vol_regime == "distribution":
            score -= params.volume_accumulation_score
        if near_high and roc is not None and roc > 0:
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
        if sma20 is not None:
            chips.append("Above SMA20" if last > sma20 else "Below SMA20")
        if sma50 is not None:
            chips.append("Above SMA50" if last > sma50 else "Below SMA50")
        if sma200 is not None:
            chips.append("Above SMA200" if last > sma200 else "Below SMA200")
        if roc is not None:
            chips.append(f"ROC{params.roc_lookback_sessions}d {roc * 100:+.1f}%")
        if pct_from_high is not None and pct_from_high <= params.pct_from_high_moderate_break_pct:
            chips.append(f"{pct_from_high:.0f}% from {params.recent_high_lookback_sessions}d high")
        if rsi is not None:
            if rsi >= params.rsi_overbought:
                chips.append(f"RSI {rsi:.0f} (overbought)")
            elif rsi <= params.rsi_oversold:
                chips.append(f"RSI {rsi:.0f} (oversold)")
            else:
                chips.append(f"RSI {rsi:.0f}")
        if gc:
            chips.append("Golden Cross")
        elif dc:
            chips.append("Death Cross")
        if hh:
            chips.append("HH/HL Uptrend")
        elif lh:
            chips.append("LH/LL Downtrend")
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

        chips = finalize_swing_technical_chips(symbol, chips)

        parts: list[str] = []
        if sma20 is not None:
            pos20 = "above" if last > sma20 else "below"
            parts.append(f"Price {pos20} SMA20 (${sma20:.2f}) — primary swing anchor.")
        if roc is not None:
            parts.append(f"{params.roc_lookback_sessions}-session change {roc * 100:+.1f}%.")
        if pct_from_high is not None and pct_from_high <= params.pct_from_high_moderate_break_pct:
            parts.append(
                f"Price {pct_from_high:.0f}% below {params.recent_high_lookback_sessions}-session high — breakdown risk."
            )
        if sma50 is not None and sma200 is not None:
            parts.append(f"Price vs SMA50 (${sma50:.2f}) and SMA200 (${sma200:.2f}) — {'uptrend' if gc else 'mixed' if not dc else 'downtrend'} structure.")
        rsi_phase = _rsi_momentum_phase(rsi, params)
        if rsi is not None:
            if rsi >= params.rsi_overbought:
                parts.append(f"Daily RSI {rsi:.0f} — overbought; late-stage momentum.")
            elif rsi <= params.rsi_oversold:
                parts.append(f"Daily RSI {rsi:.0f} — oversold.")
            else:
                parts.append(f"Daily RSI {rsi:.0f}.")
        if sma50 is not None and sma50 > 0:
            ext50 = (last - sma50) / sma50 * 100.0
            if ext50 >= params.extension_above_sma50_pct:
                parts.append(f"Price {ext50:.0f}% above SMA50 — extended vs medium-term mean.")
        if sma200 is not None and sma200 > 0:
            ext200 = (last - sma200) / sma200 * 100.0
            if ext200 >= params.extension_above_sma200_pct:
                parts.append(f"Price {ext200:.0f}% above SMA200 — structurally stretched.")
        if in_base:
            parts.append(f"Base formation ~{bd}d ({brp * 100:.1f}% range).")
        if m_now is not None and s_now is not None:
            parts.append(
                _macd_momentum_clause(
                    phase=rsi_phase, macd_above=bool(macd_above), m_now=m_now, s_now=s_now
                )
            )
        reasoning = " ".join(parts) if parts else "Daily swing technical snapshot complete."
        reasoning = sanitize_swing_reasoning_text(reasoning, symbol=symbol)

        cp = "golden_cross" if gc else "swing_composite"
        if macd_bull_cross:
            cp = "macd_bull_cross"

        return SwingTechnicalLayerResult(
            status="available",
            score=score,
            verdict=verdict,
            sma20=sma20,
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
