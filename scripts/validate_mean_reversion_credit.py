"""Research validation (read-only) for a candidate swing mean-reversion credit.

Question: when a stock is in a confirmed downtrend (price < SMA50 & SMA200,
MACD histogram < 0) AND deeply oversold, does an *oversold-led* mean-reversion
credit SEPARATE names that bounce from names that keep falling — or does it just
uniformly lift everything (in which case it doesn't earn its place)?

This does NOT modify scoring. It computes the candidate credit as-of each
historical date (no lookahead) and joins it to realized forward returns.

Candidate credit (oversold-led, per design review):
  gate        = price < SMA50 and price < SMA200 and MACD_hist < 0
  oversold    = clamp((30 - RSI) / 15, 0, 1)            # deeper RSI => more
  extension   = clamp(((SMA50 - price) / ATR) / 2.0, 0, 1)  # capped ~2 ATR
  stabilizing = close is NOT the lowest close of the last 10 sessions
  mr          = 0.7*oversold + 0.3*extension            # oversold leads
  credit      = mr if stabilizing else 0.0              # knife filter

Run:  python scripts/validate_mean_reversion_credit.py
"""

from __future__ import annotations

import asyncio
import logging
from statistics import mean

from stocvest.data.models import Timeframe
from stocvest.signals.swing_technical_analyzer import _macd_series, _sma
from stocvest.signals.technical_analyzer import _calculate_atr, _calculate_rsi
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings

logging.disable(logging.CRITICAL)

UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX", "AMD", "INTC",
    "MU", "AVGO", "QCOM", "CRM", "ADBE", "ORCL", "CSCO", "IBM", "TXN", "MRVL",
    "JPM", "BAC", "GS", "WFC", "C", "MS",
    "XOM", "CVX", "COP", "SLB", "OXY",
    "JNJ", "PFE", "MRK", "UNH", "ABBV", "LLY", "BMY",
    "PG", "KO", "PEP", "WMT", "COST", "MCD",
    "DIS", "NKE", "SBUX", "HD", "LOW",
    "BA", "CAT", "GE", "HON", "DE",
    "T", "VZ", "DAL", "UAL", "CVS", "PYPL", "SHOP", "UBER", "F", "GM",
]

CLAMP = lambda x: max(0.0, min(1.0, x))  # noqa: E731


def candidate(closes, bars, i):
    """Return (in_gate, credit, oversold, ext, stabilizing, rsi) as-of index i."""
    price = closes[i]
    sma50 = _sma(closes[: i + 1], 50)
    sma200 = _sma(closes[: i + 1], 200)
    rsi = _calculate_rsi(closes[: i + 1], 14)
    atr = _calculate_atr(bars[: i + 1], 14)
    m_now, s_now, _h, _mp, _sp = _macd_series(closes[: i + 1])
    if None in (sma50, sma200, rsi, atr, m_now, s_now) or atr <= 0:
        return False, 0.0, 0.0, 0.0, False, rsi
    macd_hist = m_now - s_now
    in_gate = price < sma50 and price < sma200 and macd_hist < 0
    if not in_gate:
        return False, 0.0, 0.0, 0.0, False, rsi
    oversold = CLAMP((30.0 - rsi) / 15.0)
    ext = CLAMP(((sma50 - price) / atr) / 2.0)
    recent_low = min(closes[max(0, i - 9): i + 1])
    stabilizing = price > recent_low * 1.0001  # not a fresh 10-day low
    mr = 0.7 * oversold + 0.3 * ext
    credit = mr if stabilizing else 0.0
    return True, credit, oversold, ext, stabilizing, rsi


async def fetch(sym, sem, client):
    async with sem:
        try:
            return sym, await client.get_bars(sym, Timeframe.DAY_1, limit=620)
        except Exception:
            return sym, []


def pct_pos(xs):
    return 100.0 * sum(1 for x in xs if x > 0) / len(xs) if xs else float("nan")


async def main():
    s = get_settings()
    sem = asyncio.Semaphore(8)
    rows = []  # (sym, date, credit, oversold, ext, stabilizing, rsi, fwd5, fwd10)
    async with PolygonClient(api_key=s.polygon_api_key) as client:
        results = await asyncio.gather(*(fetch(sym, sem, client) for sym in UNIVERSE))
    for sym, bars in results:
        if len(bars) < 230:
            continue
        closes = [b.close for b in bars]
        for i in range(200, len(closes) - 10):
            in_gate, credit, oversold, ext, stab, rsi = candidate(closes, bars, i)
            if not in_gate:
                continue
            fwd5 = closes[i + 5] / closes[i] - 1.0
            fwd10 = closes[i + 10] / closes[i] - 1.0
            rows.append((sym, bars[i].timestamp.date(), credit, oversold, ext, stab, rsi, fwd5, fwd10))

    print(f"Universe: {len(UNIVERSE)} symbols | gate cases (below SMA50&200, MACD<0): {len(rows)}\n")
    if not rows:
        print("No gate cases found.")
        return

    f5 = [r[7] for r in rows]
    f10 = [r[8] for r in rows]
    print("ALL gate cases (the population the credit fires on):")
    print(f"  n={len(rows)}  fwd5 mean={mean(f5)*100:+.2f}%  fwd10 mean={mean(f10)*100:+.2f}%  fwd10 %positive={pct_pos(f10):.0f}%\n")

    def bucket(name, pred):
        sub = [r for r in rows if pred(r)]
        if not sub:
            print(f"  {name:42} n=0")
            return
        b5 = [r[7] for r in sub]
        b10 = [r[8] for r in sub]
        print(f"  {name:42} n={len(sub):4d}  fwd5={mean(b5)*100:+.2f}%  fwd10={mean(b10)*100:+.2f}%  fwd10 %pos={pct_pos(b10):.0f}%")

    print("Separation test (does credit size track forward outcome?):")
    bucket("A: stabilizing & mr>=0.60 (strong cand.)", lambda r: r[5] and (0.7 * r[3] + 0.3 * r[4]) >= 0.60)
    bucket("B: stabilizing & 0.30<=mr<0.60", lambda r: r[5] and 0.30 <= (0.7 * r[3] + 0.3 * r[4]) < 0.60)
    bucket("C: FRESH LOW (knife, still falling)", lambda r: not r[5])
    bucket("D: stabilizing & mr<0.30 (weak)", lambda r: r[5] and (0.7 * r[3] + 0.3 * r[4]) < 0.30)
    print()
    print("Oversold-only cross-check (RSI depth vs outcome, ignoring credit):")
    bucket("RSI<20 (deep oversold)", lambda r: r[6] is not None and r[6] < 20)
    bucket("20<=RSI<25", lambda r: r[6] is not None and 20 <= r[6] < 25)
    bucket("25<=RSI<30", lambda r: r[6] is not None and 25 <= r[6] < 30)
    bucket("RSI>=30 (gated in by MACD/MA only)", lambda r: r[6] is not None and r[6] >= 30)


if __name__ == "__main__":
    asyncio.run(main())
