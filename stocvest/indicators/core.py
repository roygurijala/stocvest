"""
Technical indicators engine.

Design principles:
  1. Pure functions — no side effects, no I/O.
  2. Input: list[Bar] or list[float] (close prices / volumes).
  3. Output: list[float | None] — None for any bar that can't be calculated
     (e.g. not enough history for the first N bars of an EMA).
  4. All math is explicit — no opaque library calls.  This makes the
     SIGNAL_LOGIC.md spec verifiable line-by-line.
  5. numpy for vectorised math where natural; plain Python otherwise.

Indicators implemented:
  SMA    — Simple Moving Average
  EMA    — Exponential Moving Average  (Wilder or standard multiplier)
  RSI    — Relative Strength Index     (Wilder's 14-period, standard)
  MACD   — Moving Average Convergence/Divergence
  VWAP   — Volume Weighted Average Price (intraday reset on new day)
  BB     — Bollinger Bands (20, 2σ)
  ATR    — Average True Range
  ADX    — Average Directional Index   (+DI, -DI, ADX)
  STOCH  — Stochastic Oscillator       (%K, %D)
  OBV    — On-Balance Volume
  volume_sma  — SMA of volume (for relative volume calculation)
"""

from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np

from stocvest.data.models import Bar


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _closes(bars: list[Bar]) -> np.ndarray:
    return np.array([b.close for b in bars], dtype=float)

def _highs(bars: list[Bar]) -> np.ndarray:
    return np.array([b.high for b in bars], dtype=float)

def _lows(bars: list[Bar]) -> np.ndarray:
    return np.array([b.low for b in bars], dtype=float)

def _volumes(bars: list[Bar]) -> np.ndarray:
    return np.array([b.volume for b in bars], dtype=float)

def _pad(arr: np.ndarray, n_nones: int) -> list[Optional[float]]:
    """Prepend n_nones Nones then append the array values."""
    return [None] * n_nones + arr.tolist()

def _round(x: float, decimals: int = 4) -> float:
    return round(float(x), decimals)


# ──────────────────────────────────────────────────────────────────────────────
# SMA — Simple Moving Average
# ──────────────────────────────────────────────────────────────────────────────

def sma(values: list[float], period: int) -> list[Optional[float]]:
    """
    Simple moving average.

    Returns list of same length as values.
    First (period-1) elements are None.
    """
    if period < 1:
        raise ValueError(f"SMA period must be ≥ 1, got {period}")
    n = len(values)
    if n < period:
        return [None] * n

    arr = np.array(values, dtype=float)
    result: list[Optional[float]] = [None] * (period - 1)
    for i in range(period - 1, n):
        result.append(_round(float(np.mean(arr[i - period + 1: i + 1]))))
    return result


# ──────────────────────────────────────────────────────────────────────────────
# EMA — Exponential Moving Average
# ──────────────────────────────────────────────────────────────────────────────

def ema(values: list[float], period: int, wilder: bool = False) -> list[Optional[float]]:
    """
    Exponential moving average.

    Args:
        values: Price series (oldest first).
        period: Look-back period.
        wilder: If True, use Wilder smoothing (k = 1/period).
                If False (default), use standard EMA (k = 2/(period+1)).

    Seeded with SMA of the first `period` values.
    """
    if period < 1:
        raise ValueError(f"EMA period must be ≥ 1, got {period}")
    n = len(values)
    if n < period:
        return [None] * n

    k = 1.0 / period if wilder else 2.0 / (period + 1)
    arr = np.array(values, dtype=float)

    result: list[Optional[float]] = [None] * (period - 1)
    # seed = first SMA
    seed = float(np.mean(arr[:period]))
    result.append(_round(seed))

    prev = seed
    for i in range(period, n):
        curr = arr[i] * k + prev * (1 - k)
        result.append(_round(curr))
        prev = curr

    return result


# ──────────────────────────────────────────────────────────────────────────────
# RSI — Relative Strength Index (Wilder's method)
# ──────────────────────────────────────────────────────────────────────────────

def rsi(values: list[float], period: int = 14) -> list[Optional[float]]:
    """
    RSI using Wilder's smoothing method.

    Formula:
      gains / losses = Wilder EMA of up/down moves
      RS = avg_gain / avg_loss
      RSI = 100 - (100 / (1 + RS))
    """
    if period < 2:
        raise ValueError(f"RSI period must be ≥ 2, got {period}")
    n = len(values)
    if n <= period:
        return [None] * n

    arr = np.array(values, dtype=float)
    deltas = np.diff(arr)                                 # length n-1
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    result: list[Optional[float]] = [None] * (period)    # first `period` bars have no RSI

    # Seed: simple average of first `period` gains/losses
    avg_gain = float(np.mean(gains[:period]))
    avg_loss = float(np.mean(losses[:period]))

    def _rsi_from_avg(ag: float, al: float) -> float:
        if al == 0:
            return 100.0
        rs = ag / al
        return _round(100.0 - 100.0 / (1.0 + rs))

    result.append(_rsi_from_avg(avg_gain, avg_loss))

    # Wilder smoothing for the rest
    k = 1.0 / period
    for i in range(period, len(deltas)):
        avg_gain = avg_gain * (1 - k) + gains[i] * k
        avg_loss = avg_loss * (1 - k) + losses[i] * k
        result.append(_rsi_from_avg(avg_gain, avg_loss))

    return result


# ──────────────────────────────────────────────────────────────────────────────
# MACD — Moving Average Convergence/Divergence
# ──────────────────────────────────────────────────────────────────────────────

class MACDResult:
    __slots__ = ("macd", "signal", "histogram")

    def __init__(
        self,
        macd:      list[Optional[float]],
        signal:    list[Optional[float]],
        histogram: list[Optional[float]],
    ) -> None:
        self.macd      = macd
        self.signal    = signal
        self.histogram = histogram


def macd(
    values:       list[float],
    fast:         int = 12,
    slow:         int = 26,
    signal_period: int = 9,
) -> MACDResult:
    """
    MACD = EMA(fast) − EMA(slow)
    Signal = EMA(MACD, signal_period)
    Histogram = MACD − Signal
    """
    n = len(values)
    fast_ema  = ema(values, fast)
    slow_ema  = ema(values, slow)

    macd_line: list[Optional[float]] = []
    for f, s in zip(fast_ema, slow_ema):
        if f is None or s is None:
            macd_line.append(None)
        else:
            macd_line.append(_round(f - s))

    # Signal EMA — computed only on non-None MACD values
    # We need to pass a clean list to ema() but preserve index alignment
    valid_indices = [i for i, v in enumerate(macd_line) if v is not None]
    if len(valid_indices) < signal_period:
        signal_line: list[Optional[float]] = [None] * n
        hist_line:   list[Optional[float]] = [None] * n
        return MACDResult(macd_line, signal_line, hist_line)

    valid_macd = [macd_line[i] for i in valid_indices]  # type: ignore[misc]
    signal_vals = ema(valid_macd, signal_period)  # type: ignore[arg-type]

    signal_line = [None] * n
    hist_line   = [None] * n
    for j, idx in enumerate(valid_indices):
        sv = signal_vals[j]
        signal_line[idx] = sv
        mv = macd_line[idx]
        if sv is not None and mv is not None:
            hist_line[idx] = _round(mv - sv)

    return MACDResult(macd_line, signal_line, hist_line)


# ──────────────────────────────────────────────────────────────────────────────
# VWAP — Volume Weighted Average Price (intraday, resets each day)
# ──────────────────────────────────────────────────────────────────────────────

def vwap(bars: list[Bar]) -> list[Optional[float]]:
    """
    Intraday VWAP.  Resets at the start of each calendar day.

    Formula per bar:
      typical_price = (high + low + close) / 3
      cumulative_tpv += typical_price * volume
      cumulative_vol += volume
      vwap = cumulative_tpv / cumulative_vol

    Returns list of same length as bars.
    Any bar with zero cumulative volume returns None.
    """
    result: list[Optional[float]] = []
    cum_tpv = 0.0
    cum_vol = 0.0
    current_day: Optional[date] = None

    for bar in bars:
        bar_date = bar.timestamp.date()
        if bar_date != current_day:
            # New day — reset accumulators
            cum_tpv = 0.0
            cum_vol = 0.0
            current_day = bar_date

        typical = (bar.high + bar.low + bar.close) / 3.0
        cum_tpv += typical * bar.volume
        cum_vol += bar.volume

        if cum_vol == 0:
            result.append(None)
        else:
            result.append(_round(cum_tpv / cum_vol))

    return result


# ──────────────────────────────────────────────────────────────────────────────
# Bollinger Bands
# ──────────────────────────────────────────────────────────────────────────────

class BBResult:
    __slots__ = ("upper", "middle", "lower", "bandwidth", "percent_b")

    def __init__(
        self,
        upper:      list[Optional[float]],
        middle:     list[Optional[float]],
        lower:      list[Optional[float]],
        bandwidth:  list[Optional[float]],
        percent_b:  list[Optional[float]],
    ) -> None:
        self.upper     = upper
        self.middle    = middle
        self.lower     = lower
        self.bandwidth = bandwidth
        self.percent_b = percent_b


def bollinger_bands(
    values:    list[float],
    period:    int = 20,
    num_std:   float = 2.0,
) -> BBResult:
    """
    Bollinger Bands.

    middle = SMA(period)
    upper  = middle + num_std * rolling_stdev
    lower  = middle - num_std * rolling_stdev
    bandwidth = (upper - lower) / middle
    %B = (price - lower) / (upper - lower)
    """
    n = len(values)
    arr = np.array(values, dtype=float)

    upper:     list[Optional[float]] = [None] * (period - 1)
    middle:    list[Optional[float]] = [None] * (period - 1)
    lower:     list[Optional[float]] = [None] * (period - 1)
    bandwidth: list[Optional[float]] = [None] * (period - 1)
    percent_b: list[Optional[float]] = [None] * (period - 1)

    for i in range(period - 1, n):
        window = arr[i - period + 1: i + 1]
        m   = float(np.mean(window))
        std = float(np.std(window, ddof=0))   # population std (matches TradingView)
        u   = m + num_std * std
        l   = m - num_std * std
        bw  = (u - l) / m if m != 0 else None
        pb  = (arr[i] - l) / (u - l) if (u - l) != 0 else None

        upper.append(_round(u))
        middle.append(_round(m))
        lower.append(_round(l))
        bandwidth.append(_round(bw) if bw is not None else None)
        percent_b.append(_round(pb) if pb is not None else None)

    return BBResult(upper, middle, lower, bandwidth, percent_b)


# ──────────────────────────────────────────────────────────────────────────────
# ATR — Average True Range (Wilder's smoothing)
# ──────────────────────────────────────────────────────────────────────────────

def atr(bars: list[Bar], period: int = 14) -> list[Optional[float]]:
    """
    Average True Range.

    True Range = max(high-low, |high-prev_close|, |low-prev_close|)
    ATR = Wilder EMA of TR with period.

    Returns list same length as bars.
    First bar is None (no prev close).
    ATR is None until period+1 bars have been seen.
    """
    n = len(bars)
    if n < 2:
        return [None] * n

    highs  = _highs(bars)
    lows   = _lows(bars)
    closes = _closes(bars)

    # True ranges — length n-1 (index 0 = bar 1)
    tr: list[float] = []
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i]  - closes[i - 1])
        tr.append(max(hl, hpc, lpc))

    # Wilder EMA of TR
    atr_vals = ema(tr, period, wilder=True)
    # Prepend one None (for bar index 0 which has no prev close)
    return [None] + atr_vals


# ──────────────────────────────────────────────────────────────────────────────
# ADX — Average Directional Index
# ──────────────────────────────────────────────────────────────────────────────

class ADXResult:
    __slots__ = ("adx", "plus_di", "minus_di")

    def __init__(
        self,
        adx:      list[Optional[float]],
        plus_di:  list[Optional[float]],
        minus_di: list[Optional[float]],
    ) -> None:
        self.adx      = adx
        self.plus_di  = plus_di
        self.minus_di = minus_di


def adx(bars: list[Bar], period: int = 14) -> ADXResult:
    """
    Average Directional Index with +DI and -DI.

    Algorithm (Wilder):
      +DM = high[i] - high[i-1] if > 0 and > (low[i-1] - low[i]), else 0
      -DM = low[i-1] - low[i]  if > 0 and > (high[i] - high[i-1]), else 0
      Smooth +DM, -DM, TR with Wilder EMA(period)
      +DI = 100 * Smooth+DM / ATR
      -DI = 100 * Smooth-DM / ATR
      DX  = 100 * |+DI - -DI| / (+DI + -DI)
      ADX = Wilder EMA(DX, period)
    """
    n = len(bars)
    if n < 2:
        return ADXResult([None] * n, [None] * n, [None] * n)

    highs  = _highs(bars)
    lows   = _lows(bars)
    closes = _closes(bars)

    tr_list: list[float]   = []
    pdm_list: list[float]  = []
    mdm_list: list[float]  = []

    for i in range(1, n):
        up   = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        pdm_list.append(up   if up > 0 and up > down else 0.0)
        mdm_list.append(down if down > 0 and down > up else 0.0)

        hl  = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i]  - closes[i - 1])
        tr_list.append(max(hl, hpc, lpc))

    # Wilder smoothed
    sm_tr  = ema(tr_list,  period, wilder=True)
    sm_pdm = ema(pdm_list, period, wilder=True)
    sm_mdm = ema(mdm_list, period, wilder=True)

    # DI lines — length same as tr_list
    plus_di_raw:  list[Optional[float]] = []
    minus_di_raw: list[Optional[float]] = []
    dx_raw:       list[Optional[float]] = []

    for tr_v, pdm_v, mdm_v in zip(sm_tr, sm_pdm, sm_mdm):
        if tr_v is None or pdm_v is None or mdm_v is None or tr_v == 0:
            plus_di_raw.append(None)
            minus_di_raw.append(None)
            dx_raw.append(None)
        else:
            pdi = _round(100.0 * pdm_v / tr_v)
            mdi = _round(100.0 * mdm_v / tr_v)
            plus_di_raw.append(pdi)
            minus_di_raw.append(mdi)
            denom = pdi + mdi
            if denom == 0:
                dx_raw.append(None)
            else:
                dx_raw.append(_round(100.0 * abs(pdi - mdi) / denom))

    # ADX = Wilder EMA of DX — only over non-None values, then realign
    valid_dx_indices = [i for i, v in enumerate(dx_raw) if v is not None]
    adx_aligned: list[Optional[float]] = [None] * len(dx_raw)
    if len(valid_dx_indices) >= period:
        valid_dx = [dx_raw[i] for i in valid_dx_indices]  # type: ignore[misc]
        adx_vals = ema(valid_dx, period, wilder=True)  # type: ignore[arg-type]
        for j, idx in enumerate(valid_dx_indices):
            adx_aligned[idx] = adx_vals[j]

    # All outputs are length n-1 (one per gap), prepend None for bar 0
    return ADXResult(
        adx=      [None] + adx_aligned,
        plus_di=  [None] + plus_di_raw,
        minus_di= [None] + minus_di_raw,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Stochastic Oscillator
# ──────────────────────────────────────────────────────────────────────────────

class StochResult:
    __slots__ = ("k", "d")

    def __init__(
        self,
        k: list[Optional[float]],
        d: list[Optional[float]],
    ) -> None:
        self.k = k
        self.d = d


def stochastic(
    bars:      list[Bar],
    k_period:  int = 14,
    d_period:  int = 3,
    smooth_k:  int = 3,
) -> StochResult:
    """
    Stochastic Oscillator (%K, %D).

    %K_raw = 100 * (close - lowest_low(k_period)) / (highest_high(k_period) - lowest_low(k_period))
    %K = SMA(%K_raw, smooth_k)   [= "slow %K"]
    %D = SMA(%K, d_period)
    """
    n = len(bars)
    highs  = _highs(bars)
    lows   = _lows(bars)
    closes = _closes(bars)

    k_raw: list[Optional[float]] = [None] * (k_period - 1)
    for i in range(k_period - 1, n):
        hh = float(np.max(highs[i - k_period + 1: i + 1]))
        ll = float(np.min(lows[ i - k_period + 1: i + 1]))
        denom = hh - ll
        if denom == 0:
            k_raw.append(50.0)  # midpoint when range is 0
        else:
            k_raw.append(_round(100.0 * (closes[i] - ll) / denom))

    k_raw_floats = [v for v in k_raw if v is not None]
    k_vals_raw = sma(k_raw_floats, smooth_k)

    # Realign to original index
    k_result: list[Optional[float]] = [None] * (k_period - 1)
    for v in k_vals_raw:
        k_result.append(v)

    k_floats = [v for v in k_result if v is not None]
    d_vals_raw = sma(k_floats, d_period)
    d_result: list[Optional[float]] = [None] * (len(k_result) - len(d_vals_raw))
    for v in d_vals_raw:
        d_result.append(v)

    # Pad d to same length as k
    while len(d_result) < n:
        d_result.insert(0, None)
    d_result = d_result[:n]

    return StochResult(k=k_result[:n], d=d_result)


# ──────────────────────────────────────────────────────────────────────────────
# OBV — On-Balance Volume
# ──────────────────────────────────────────────────────────────────────────────

def obv(bars: list[Bar]) -> list[float]:
    """
    On-Balance Volume.

    OBV[0] = volume[0]
    OBV[i] = OBV[i-1] + volume[i]  if close[i] > close[i-1]
           = OBV[i-1] - volume[i]  if close[i] < close[i-1]
           = OBV[i-1]              if close[i] == close[i-1]
    """
    closes  = _closes(bars)
    volumes = _volumes(bars)
    n = len(bars)

    result = [0.0] * n
    if n == 0:
        return result

    result[0] = volumes[0]
    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            result[i] = result[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            result[i] = result[i - 1] - volumes[i]
        else:
            result[i] = result[i - 1]

    return result


# ──────────────────────────────────────────────────────────────────────────────
# Volume SMA (for relative volume)
# ──────────────────────────────────────────────────────────────────────────────

def volume_sma(bars: list[Bar], period: int = 20) -> list[Optional[float]]:
    """Average daily volume over `period` bars — used to compute relative volume."""
    vols = [b.volume for b in bars]
    return sma(vols, period)


def relative_volume(bars: list[Bar], period: int = 20) -> list[Optional[float]]:
    """
    Relative Volume = today's volume / avg_volume(period).

    Values > 1.5 indicate above-average activity.
    Values > 3.0 indicate a catalyst event.
    """
    vol_avg = volume_sma(bars, period)
    result: list[Optional[float]] = []
    for bar, avg in zip(bars, vol_avg):
        if avg is None or avg == 0:
            result.append(None)
        else:
            result.append(_round(bar.volume / avg))
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Opening Range (Day trading — Phase 2.5)
# ──────────────────────────────────────────────────────────────────────────────

class OpeningRange:
    __slots__ = ("high", "low", "midpoint")

    def __init__(self, high: float, low: float) -> None:
        self.high     = high
        self.low      = low
        self.midpoint = (high + low) / 2.0


def opening_range(bars: list[Bar], minutes: int = 15) -> Optional[OpeningRange]:
    """
    Calculate the opening range from the first `minutes` of a trading day.

    Expects bars to be 1-minute bars from a single day, sorted oldest-first.
    """
    if not bars:
        return None
    or_bars = bars[:minutes]
    if not or_bars:
        return None
    high = max(b.high for b in or_bars)
    low  = min(b.low  for b in or_bars)
    return OpeningRange(high, low)


# ──────────────────────────────────────────────────────────────────────────────
# Gap Calculator (pre-market, used by day trading scanner)
# ──────────────────────────────────────────────────────────────────────────────

def gap_percent(prev_close: float, current_price: float) -> float:
    """
    Percentage gap from previous close to current price.

    Positive = gap up, negative = gap down.
    """
    if prev_close == 0:
        return 0.0
    return _round(((current_price - prev_close) / prev_close) * 100)
