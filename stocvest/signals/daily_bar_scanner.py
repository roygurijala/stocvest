"""
Daily-bar swing setup scanner: EMA20/50/200 structure, weekly RSI recovery,
volume expansion vs 20D average on range/breakout days, and pattern maturity (days in setup).
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import date
from typing import Optional

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import SymbolLiquidityContext
from stocvest.signals.technical_analyzer import _calculate_rsi


def _ema_series(closes: list[float], period: int) -> list[Optional[float]]:
    """EMA at each index; indices < period-1 are None."""
    n = len(closes)
    out: list[Optional[float]] = [None] * n
    if n < period:
        return out
    mult = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = round(ema, 6)
    for i in range(period, n):
        ema = (closes[i] - ema) * mult + ema
        out[i] = round(ema, 6)
    return out


def _cross_up(prev_a: Optional[float], prev_b: Optional[float], a: Optional[float], b: Optional[float]) -> bool:
    if None in (prev_a, prev_b, a, b):
        return False
    return float(prev_a) <= float(prev_b) and float(a) > float(b)


def _cross_down(prev_a: Optional[float], prev_b: Optional[float], a: Optional[float], b: Optional[float]) -> bool:
    if None in (prev_a, prev_b, a, b):
        return False
    return float(prev_a) >= float(prev_b) and float(a) < float(b)


def _weekly_last_closes(bars: list[Bar]) -> list[float]:
    """One close per ISO week (last daily bar in that week), chronological."""
    by_week: "OrderedDict[tuple[int, int], float]" = OrderedDict()
    for b in sorted(bars, key=lambda x: x.timestamp):
        d = b.timestamp.date() if hasattr(b.timestamp, "date") else date.fromisoformat(str(b.timestamp)[:10])
        iso = d.isocalendar()
        key = (int(iso.year), int(iso.week))
        by_week[key] = float(b.close)
    return list(by_week.values())


def _weekly_rsi_recovery(weekly_closes: list[float]) -> tuple[bool, Optional[float]]:
    """Oversold washout in recent weeks with RSI now recovering but not extreme."""
    if len(weekly_closes) < 18:
        return False, None
    rsi_now = _calculate_rsi(weekly_closes, 14)
    if rsi_now is None:
        return False, None
    mins: list[float] = []
    for end in range(15, len(weekly_closes) + 1):
        sub = weekly_closes[:end]
        r = _calculate_rsi(sub, 14)
        if r is not None:
            mins.append(float(r))
    if len(mins) < 6:
        return False, float(rsi_now)
    tail = mins[-10:]
    min_r = min(tail)
    r_now = float(rsi_now)
    recovery = min_r < 36.0 and r_now > min_r + 4.0 and 32.0 < r_now < 68.0
    return recovery, r_now


def _volume_vs_20d_avg(bars: list[Bar]) -> tuple[Optional[float], bool]:
    """(ratio last vol / avg prior 20 sessions, breakout above prior 20D high)."""
    if len(bars) < 22:
        return None, False
    last = bars[-1]
    prior = bars[-21:-1]
    vols = [float(b.volume) for b in prior if b.volume and float(b.volume) > 0]
    if len(vols) < 10:
        return None, False
    avg20 = sum(vols[-20:]) / min(20, len(vols))
    if avg20 <= 0:
        return None, False
    ratio = float(last.volume) / avg20 if last.volume else None
    high20 = max(float(b.high) for b in prior[-20:])
    breakout = float(last.close) > high20 * 1.001
    return ratio, breakout


def _pattern_maturity_days_long(
    bars: list[Bar], ema20: list[Optional[float]], ema50: list[Optional[float]]
) -> int:
    """Consecutive days (including last) with close > EMA20 > EMA50."""
    days = 0
    for i in range(len(bars) - 1, -1, -1):
        e2 = ema20[i]
        e5 = ema50[i]
        c = float(bars[i].close)
        if e2 is None or e5 is None:
            break
        if c > float(e2) > float(e5):
            days += 1
        else:
            break
    return days


def _pattern_maturity_days_short(
    bars: list[Bar], ema20: list[Optional[float]], ema50: list[Optional[float]]
) -> int:
    days = 0
    for i in range(len(bars) - 1, -1, -1):
        e2 = ema20[i]
        e5 = ema50[i]
        c = float(bars[i].close)
        if e2 is None or e5 is None:
            break
        if c < float(e2) < float(e5):
            days += 1
        else:
            break
    return days


@dataclass(frozen=True)
class DailyBarSetupCandidate:
    symbol: str
    direction: str
    score: float
    triggers: list[str]
    last_price: float
    timestamp_iso: str
    company_name: Optional[str]
    volume_vs_avg: float
    ema_daily_crossovers: list[str]
    weekly_rsi_recovery: bool
    weekly_rsi: Optional[float]
    volume_expansion_ratio: Optional[float]
    pattern_maturity_days: int


class DailyBarScanner:
    """
    Rank swing-style candidates from daily OHLCV bars (``Timeframe.DAY_1``).

    Signals:
      - EMA20 / EMA50 / EMA200 bullish or bearish crossovers (latest session vs prior)
      - Weekly RSI recovery from oversold (ISO-week aggregated closes)
      - Volume expansion vs 20-day average on a 20-day range breakout day
      - Pattern maturity: consecutive days close above EMA20 > EMA50 (long) or inverse (short)
    """

    def __init__(self, *, min_score: float = 0.48, min_bars: int = 205) -> None:
        self._min_score = min_score
        self._min_bars = min_bars

    def scan(
        self,
        bars_by_symbol: dict[str, list[Bar]],
        *,
        liquidity_by_symbol: dict[str, SymbolLiquidityContext] | None = None,
        limit: int = 8,
    ) -> list[DailyBarSetupCandidate]:
        liq_map = liquidity_by_symbol or {}
        out: list[DailyBarSetupCandidate] = []
        for symbol, bars in bars_by_symbol.items():
            sym = symbol.upper()
            if len(bars) < self._min_bars:
                continue
            if any(b.symbol.upper() != sym for b in bars):
                continue
            if any(b.timeframe != Timeframe.DAY_1 for b in bars):
                continue
            bars_sorted = sorted(bars, key=lambda b: b.timestamp)
            c = self._scan_symbol(sym, bars_sorted, liq_map.get(sym))
            if c is not None:
                out.append(c)
        out.sort(key=lambda x: x.score, reverse=True)
        return out[: max(0, limit)]

    def _scan_symbol(
        self,
        symbol: str,
        bars: list[Bar],
        liq: Optional[SymbolLiquidityContext],
    ) -> Optional[DailyBarSetupCandidate]:
        closes = [float(b.close) for b in bars]
        ema20 = _ema_series(closes, 20)
        ema50 = _ema_series(closes, 50)
        ema200 = _ema_series(closes, 200)
        n = len(bars)
        i = n - 1
        i_prev = n - 2

        long_triggers: list[str] = []
        short_triggers: list[str] = []
        long_score = 0.0
        short_score = 0.0

        if _cross_up(ema20[i_prev], ema50[i_prev], ema20[i], ema50[i]):
            long_triggers.append("ema20_cross_above_50")
            long_score += 0.22
        if _cross_down(ema20[i_prev], ema50[i_prev], ema20[i], ema50[i]):
            short_triggers.append("ema20_cross_below_50")
            short_score += 0.22

        if ema50[i_prev] is not None and ema200[i_prev] is not None and ema50[i] is not None and ema200[i] is not None:
            if _cross_up(ema50[i_prev], ema200[i_prev], ema50[i], ema200[i]):
                long_triggers.append("ema50_cross_above_200")
                long_score += 0.28
            if _cross_down(ema50[i_prev], ema200[i_prev], ema50[i], ema200[i]):
                short_triggers.append("ema50_cross_below_200")
                short_score += 0.28

        if ema20[i_prev] is not None and ema200[i_prev] is not None and ema20[i] is not None and ema200[i] is not None:
            if _cross_up(ema20[i_prev], ema200[i_prev], ema20[i], ema200[i]):
                long_triggers.append("ema20_cross_above_200")
                long_score += 0.18
            if _cross_down(ema20[i_prev], ema200[i_prev], ema20[i], ema200[i]):
                short_triggers.append("ema20_cross_below_200")
                short_score += 0.18

        weekly = _weekly_last_closes(bars)
        rec_long, w_rsi = _weekly_rsi_recovery(weekly)
        if rec_long:
            long_triggers.append("weekly_rsi_recovery")
            long_score += 0.2

        vol_ratio, breakout = _volume_vs_20d_avg(bars)
        if vol_ratio is not None and vol_ratio >= 1.45 and breakout:
            tag = "volume_expansion_breakout"
            if long_score >= short_score and (long_score > 0 or short_score == 0):
                long_triggers.append(tag)
                long_score += 0.24
            elif short_score > 0:
                short_triggers.append(tag)
                short_score += 0.24
            elif float(bars[i].close) >= float(bars[i_prev].close):
                long_triggers.append(tag)
                long_score += 0.18
            else:
                short_triggers.append(tag)
                short_score += 0.18

        last_bar = bars[-1]
        company = liq.company_name if liq and liq.company_name else None
        adv = liq.avg_daily_volume if liq and liq.avg_daily_volume else None
        vol_vs = float(last_bar.volume) / max(1e-9, adv) if adv and adv > 0 else float(vol_ratio or 1.0)

        mat_long = _pattern_maturity_days_long(bars, ema20, ema50)
        mat_short = _pattern_maturity_days_short(bars, ema20, ema50)

        if long_score >= short_score and long_score >= self._min_score:
            score = round(min(1.0, long_score), 4)
            ema_x = [t for t in long_triggers if t.startswith("ema")]
            return DailyBarSetupCandidate(
                symbol=symbol,
                direction="long",
                score=score,
                triggers=list(long_triggers),
                last_price=float(last_bar.close),
                timestamp_iso=last_bar.timestamp.isoformat(),
                company_name=company,
                volume_vs_avg=round(vol_vs, 4),
                ema_daily_crossovers=ema_x,
                weekly_rsi_recovery=bool(rec_long),
                weekly_rsi=w_rsi,
                volume_expansion_ratio=round(vol_ratio, 4) if vol_ratio is not None else None,
                pattern_maturity_days=mat_long,
            )

        if short_score >= self._min_score:
            score = round(min(1.0, short_score), 4)
            ema_x = [t for t in short_triggers if t.startswith("ema")]
            return DailyBarSetupCandidate(
                symbol=symbol,
                direction="short",
                score=score,
                triggers=list(short_triggers),
                last_price=float(last_bar.close),
                timestamp_iso=last_bar.timestamp.isoformat(),
                company_name=company,
                volume_vs_avg=round(vol_vs, 4),
                ema_daily_crossovers=ema_x,
                weekly_rsi_recovery=False,
                weekly_rsi=w_rsi,
                volume_expansion_ratio=round(vol_ratio, 4) if vol_ratio is not None else None,
                pattern_maturity_days=mat_short,
            )
        return None
