"""Position / weekly-bar structural trend layer (ADR-004 POS-D3).

Primary read: weekly bars (SMA50/200, 52-week range, stage base, RS vs SPY).
Daily bars provide confirmation only — not the primary swing/intraday stack.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from stocvest.config.signal_parameters import PositionTechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.swing_technical_analyzer import _higher_highs_lows, _lower_highs_lows, _sma


def _iso_week_key(ts: datetime | date | None) -> tuple[int, int] | None:
    if ts is None:
        return None
    if isinstance(ts, date) and not isinstance(ts, datetime):
        dt = ts
    elif isinstance(ts, datetime):
        dt = ts.date() if ts.tzinfo is None else ts.astimezone().date()
    else:
        return None
    iso = dt.isocalendar()
    return (iso[0], iso[1])


def aggregate_daily_to_weekly_bars(daily_bars: list[Bar], symbol: str) -> list[Bar]:
    """Collapse ascending daily RTH bars into ISO-week OHLCV bars."""
    ordered = sorted(daily_bars, key=lambda b: b.timestamp)
    buckets: dict[tuple[int, int], list[Bar]] = {}
    order: list[tuple[int, int]] = []
    for bar in ordered:
        key = _iso_week_key(bar.timestamp)
        if key is None:
            continue
        if key not in buckets:
            order.append(key)
            buckets[key] = []
        buckets[key].append(bar)

    weekly: list[Bar] = []
    for key in order:
        chunk = buckets[key]
        if not chunk:
            continue
        weekly.append(
            Bar(
                symbol=symbol,
                timestamp=chunk[-1].timestamp,
                timeframe=Timeframe.WEEK_1,
                open=float(chunk[0].open),
                high=max(float(b.high) for b in chunk),
                low=min(float(b.low) for b in chunk),
                close=float(chunk[-1].close),
                volume=sum(float(b.volume) for b in chunk),
            )
        )
    return weekly


def _weekly_closes(bars: list[Bar]) -> list[float]:
    return [float(b.close) for b in bars]


def _relative_strength_pct(
    subject_closes: list[float],
    benchmark_closes: list[float],
    lookback: int,
) -> Optional[float]:
    """Subject return minus benchmark return over ``lookback`` periods (percent)."""
    if lookback <= 0:
        return None
    need = lookback + 1
    if len(subject_closes) < need or len(benchmark_closes) < need:
        return None
    sub_old, sub_new = subject_closes[-need], subject_closes[-1]
    bench_old, bench_new = benchmark_closes[-need], benchmark_closes[-1]
    if sub_old <= 0 or bench_old <= 0:
        return None
    sub_ret = (sub_new - sub_old) / sub_old * 100.0
    bench_ret = (bench_new - bench_old) / bench_old * 100.0
    return sub_ret - bench_ret


def _weekly_base_formation(
    bars: list[Bar],
    params: PositionTechnicalParameters,
) -> tuple[bool, int, float]:
    if len(bars) < params.base_min_weeks:
        return False, 0, 0.0
    for w in range(min(params.base_max_weeks, len(bars)), params.base_min_weeks - 1, -1):
        chunk = bars[-w:]
        hi = max(b.high for b in chunk)
        lo = min(b.low for b in chunk)
        if lo <= 0:
            continue
        rng = (hi - lo) / lo
        if rng <= params.base_max_range_pct:
            return True, w, float(rng)
    return False, 0, 0.0


def _range_position_pct(last: float, hi: float, lo: float) -> Optional[float]:
    if hi <= lo or hi <= 0:
        return None
    return (last - lo) / (hi - lo) * 100.0


@dataclass
class PositionTechnicalLayerResult:
    status: str
    score: Optional[int]
    verdict: str
    weekly_sma50: Optional[float] = None
    weekly_sma200: Optional[float] = None
    daily_sma50: Optional[float] = None
    daily_sma200: Optional[float] = None
    pct_from_52w_high: Optional[float] = None
    range_position_pct: Optional[float] = None
    rs_vs_spy_6m_pct: Optional[float] = None
    golden_cross: bool = False
    higher_highs_lows: bool = False
    in_base: bool = False
    base_weeks: int = 0
    base_range_pct: float = 0.0
    daily_confirm_bullish: bool = False
    weekly_bars_analyzed: int = 0
    daily_bars_analyzed: int = 0
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)
    confluence_pattern: str = "position_composite"


class PositionTechnicalAnalyzer:
    def analyze(
        self,
        symbol: str,
        daily_bars: list[Bar],
        snapshot: Snapshot,
        params: PositionTechnicalParameters,
        *,
        spy_weekly_bars: list[Bar] | None = None,
    ) -> PositionTechnicalLayerResult:
        _ = snapshot
        weekly = aggregate_daily_to_weekly_bars(daily_bars, symbol)
        n_weekly = len(weekly)

        if n_weekly < params.min_weekly_bars_degraded:
            return PositionTechnicalLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                weekly_bars_analyzed=n_weekly,
                daily_bars_analyzed=len(daily_bars),
                reasoning=(
                    f"Insufficient weekly history for position technicals "
                    f"(need at least {params.min_weekly_bars_degraded} weeks)."
                ),
                chips=[],
            )

        status = "available" if n_weekly >= params.min_weekly_bars_full else "as_of_close"
        weekly_sorted = sorted(weekly, key=lambda b: b.timestamp)
        w_closes = _weekly_closes(weekly_sorted)
        last = w_closes[-1]

        sma50 = _sma(w_closes, params.sma_fast_period)
        sma200 = _sma(w_closes, params.sma_slow_period)

        daily_sorted = sorted(daily_bars, key=lambda b: b.timestamp) if daily_bars else []
        d_closes = [float(b.close) for b in daily_sorted]
        d_last = d_closes[-1] if d_closes else last
        daily_sma50 = _sma(d_closes, params.daily_confirm_sma_fast) if d_closes else None
        daily_sma200 = _sma(d_closes, params.daily_confirm_sma_slow) if d_closes else None

        lookback = min(params.range_lookback_weeks, len(weekly_sorted))
        range_chunk = weekly_sorted[-lookback:]
        range_high = max(float(b.high) for b in range_chunk)
        range_low = min(float(b.low) for b in range_chunk)
        pct_from_high: Optional[float] = None
        if range_high > 0:
            pct_from_high = (last - range_high) / range_high * 100.0
        range_pos = _range_position_pct(last, range_high, range_low)

        rs_pct: Optional[float] = None
        if spy_weekly_bars:
            spy_sorted = sorted(spy_weekly_bars, key=lambda b: b.timestamp)
            spy_closes = _weekly_closes(spy_sorted)
            rs_pct = _relative_strength_pct(
                w_closes,
                spy_closes,
                params.rs_lookback_weeks,
            )

        in_base, base_weeks, base_rng = _weekly_base_formation(weekly_sorted, params)
        hh = _higher_highs_lows(weekly_sorted, lookback=params.structure_lookback_weeks)
        lh = _lower_highs_lows(weekly_sorted, lookback=params.structure_lookback_weeks)
        gc = bool(sma50 and sma200 and sma50 > sma200)

        daily_confirm = bool(
            daily_sma200 is not None and d_last > daily_sma200 and daily_sma50 is not None and d_last > daily_sma50
        )

        score = 50

        if sma50 is not None:
            score += params.above_sma50_score if last > sma50 else -params.below_sma50_score
        if sma200 is not None:
            score += params.above_sma200_score if last > sma200 else -params.below_sma200_score
        elif daily_sma200 is not None:
            score += params.daily_confirm_score if d_last > daily_sma200 else -params.daily_confirm_score

        if gc and sma50 is not None and sma200 is not None and last > sma50 and last > sma200:
            score += params.golden_cross_score

        if pct_from_high is not None:
            if pct_from_high <= params.pct_from_high_strong_break_pct:
                score -= params.pct_from_high_strong_penalty
            elif pct_from_high <= params.pct_from_high_moderate_break_pct:
                score -= params.pct_from_high_moderate_penalty
            elif pct_from_high >= -5.0:
                score += params.near_52w_high_score

        if rs_pct is not None:
            if rs_pct >= params.rs_strong_outperform_pct:
                score += params.rs_strong_score
            elif rs_pct >= params.rs_moderate_outperform_pct:
                score += params.rs_moderate_score
            elif rs_pct <= params.rs_strong_underperform_pct:
                score -= params.rs_strong_score
            elif rs_pct <= params.rs_moderate_underperform_pct:
                score -= params.rs_moderate_score

        if lh:
            score -= params.lower_highs_lows_score
        elif hh:
            score += params.higher_highs_lows_score

        if in_base:
            score += params.base_formation_score

        if daily_confirm and sma50 is not None and last <= sma50:
            score += params.daily_confirm_score

        score = int(max(0, min(100, score)))

        if score >= params.bullish_threshold:
            verdict = "bullish"
        elif score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips: list[str] = []
        if sma50 is not None:
            chips.append("Above W-SMA50" if last > sma50 else "Below W-SMA50")
        if sma200 is not None:
            chips.append("Above W-SMA200" if last > sma200 else "Below W-SMA200")
        elif daily_sma200 is not None:
            chips.append("Above D-SMA200 (confirm)" if d_last > daily_sma200 else "Below D-SMA200 (confirm)")
        if pct_from_high is not None:
            chips.append(f"{pct_from_high:+.0f}% from 52w high")
        if rs_pct is not None:
            chips.append(f"RS vs SPY 6M {rs_pct:+.1f}%")
        if gc:
            chips.append("Weekly golden cross")
        if hh:
            chips.append("Weekly HH/HL")
        elif lh:
            chips.append("Weekly LH/LL")
        if in_base:
            chips.append(f"Base {base_weeks}w")
        if daily_confirm:
            chips.append("Daily trend confirm")
        if status == "as_of_close":
            chips.append("Limited weekly history")

        parts: list[str] = []
        if sma50 is not None and sma200 is not None:
            struct = "uptrend" if last > sma50 and last > sma200 else "downtrend" if last < sma50 and last < sma200 else "mixed"
            parts.append(
                f"Weekly close vs SMA50/SMA200 — {struct} structure ({n_weekly} weeks analyzed)."
            )
        if pct_from_high is not None and pct_from_high <= params.pct_from_high_moderate_break_pct:
            parts.append(f"Price {pct_from_high:.0f}% below 52-week high — extended pullback risk.")
        elif range_pos is not None and range_pos >= 85.0:
            parts.append("Trading in upper quartile of 52-week range.")
        if rs_pct is not None:
            parts.append(f"6-month relative strength vs SPY: {rs_pct:+.1f}%.")
        if in_base:
            parts.append(f"Weekly base ~{base_weeks} weeks ({base_rng * 100:.1f}% range).")
        if daily_confirm:
            parts.append("Daily SMA50/200 confirm long-term trend alignment.")
        if status == "as_of_close":
            parts.append(
                f"Degraded read — fewer than {params.min_weekly_bars_full} weekly bars; "
                "scores use available history only."
            )
        reasoning = " ".join(parts) if parts else "Weekly structural trend snapshot complete."

        return PositionTechnicalLayerResult(
            status=status,
            score=score,
            verdict=verdict,
            weekly_sma50=sma50,
            weekly_sma200=sma200,
            daily_sma50=daily_sma50,
            daily_sma200=daily_sma200,
            pct_from_52w_high=pct_from_high,
            range_position_pct=range_pos,
            rs_vs_spy_6m_pct=rs_pct,
            golden_cross=gc,
            higher_highs_lows=hh,
            in_base=in_base,
            base_weeks=base_weeks,
            base_range_pct=base_rng,
            daily_confirm_bullish=daily_confirm,
            weekly_bars_analyzed=n_weekly,
            daily_bars_analyzed=len(daily_bars),
            reasoning=reasoning,
            chips=chips,
        )
