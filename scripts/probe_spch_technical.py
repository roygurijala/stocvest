"""One-off diagnostic: why does SPCH (or any symbol) get its swing Technical score?

Fetches live daily bars and runs the real SwingTechnicalAnalyzer, then dumps the
final score + verdict + reasoning + chips and the raw indicators that drive it.
Read-only. Run:  python scripts/probe_spch_technical.py SPCH
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timezone

from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.models import Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.swing_technical_analyzer import (
    SwingTechnicalAnalyzer,
    _daily_rsi,
    _macd_series,
    _rate_of_change,
    _recent_range_high,
    _sma,
)
from stocvest.signals.technical_analyzer import _calculate_atr
from stocvest.utils.config import get_settings

logging.disable(logging.CRITICAL)


async def main(symbol: str) -> None:
    s = get_settings()
    params = SignalParameters().swing_technical
    async with PolygonClient(api_key=s.polygon_api_key) as client:
        bars = await client.get_bars(symbol, Timeframe.DAY_1, limit=420)

    if len(bars) < 60:
        print(f"{symbol}: only {len(bars)} daily bars — insufficient.")
        return

    bars = sorted(bars, key=lambda b: b.timestamp)
    closes = [b.close for b in bars]
    last = closes[-1]
    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, params.sma_fast_period)
    sma200 = _sma(closes, params.sma_slow_period)
    rsi = _daily_rsi(closes, params.rsi_period)
    m_now, sig_now, hist_now, _, _ = _macd_series(closes)
    roc = _rate_of_change(closes, params.roc_lookback_sessions)
    recent_high = _recent_range_high(bars, params.recent_high_lookback_sessions)
    pct_from_high = (last - recent_high) / recent_high * 100.0 if recent_high else None
    atr = _calculate_atr(bars, params.atr_period)

    snap = Snapshot(symbol=symbol, last_trade_price=last, prev_close=closes[-2], change_percent=0.0)
    res = SwingTechnicalAnalyzer().analyze(symbol, bars, snap, params)

    def fmt(x):  # noqa: ANN001
        return f"{x:.2f}" if isinstance(x, float) else str(x)

    print(f"\n=== {symbol} swing technical probe ({datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC) ===")
    print(f"bars={len(bars)}  last_close={fmt(last)}")
    print(f"SMA20={fmt(sma20)}  SMA50={fmt(sma50)}  SMA200={fmt(sma200)}")
    gc = bool(sma50 and sma200 and sma50 > sma200)
    durable = bool(gc and sma50 and sma200 and last > sma50 and last > sma200)
    print(f"price vs SMA50: {'ABOVE' if sma50 and last>sma50 else 'BELOW'}   "
          f"price vs SMA200: {'ABOVE' if sma200 and last>sma200 else 'BELOW'}")
    print(f"golden_cross(50>200)={gc}   durable_uptrend(above both + GC)={durable}")
    print(f"RSI={fmt(rsi)}   MACD m={fmt(m_now)} sig={fmt(sig_now)} hist={fmt(hist_now)}")
    print(f"ROC{params.roc_lookback_sessions}d={roc*100:+.1f}%" if roc is not None else "ROC=None")
    print(f"recent_high({params.recent_high_lookback_sessions}d)={fmt(recent_high)}  pct_from_high="
          f"{pct_from_high:+.1f}%" if pct_from_high is not None else "pct_from_high=None")
    print(f"ATR({params.atr_period})={fmt(atr)}")
    print(f"\nmean_reversion gate needs: last<SMA50 AND last<SMA200 AND hist<0 AND RSI<"
          f"{params.mean_reversion_oversold_rsi}")
    print(f"  -> RSI<{params.mean_reversion_oversold_rsi}? {rsi is not None and rsi < params.mean_reversion_oversold_rsi}")
    print(f"\nFINAL  score={res.score}  verdict={res.verdict}")
    print(f"chips: {res.chips}")
    print(f"reasoning: {res.reasoning}")

    # --- Golden-cross credit experiment -------------------------------------
    # Re-run with golden_cross_score forced to 0 and to an exaggerated value.
    # If the credit were firing for this symbol the final score would change.
    from dataclasses import replace as _replace

    p_zero = _replace(params, golden_cross_score=0)
    p_huge = _replace(params, golden_cross_score=200)
    r_zero = SwingTechnicalAnalyzer().analyze(symbol, bars, snap, p_zero)
    r_huge = SwingTechnicalAnalyzer().analyze(symbol, bars, snap, p_huge)
    print("\n--- golden_cross_score sensitivity (does the credit fire here?) ---")
    print(f"  default(gc_score={params.golden_cross_score}) -> {res.score}")
    print(f"  gc_score=0                 -> {r_zero.score}")
    print(f"  gc_score=200 (exaggerated) -> {r_huge.score}")
    if res.score == r_zero.score == r_huge.score:
        print("  => golden-cross credit is NOT contributing to this score (gated off by price).")
    else:
        print("  => golden-cross credit IS contributing — score moves with the param.")


if __name__ == "__main__":
    sym = sys.argv[1].upper() if len(sys.argv) > 1 else "SPCH"
    asyncio.run(main(sym))
