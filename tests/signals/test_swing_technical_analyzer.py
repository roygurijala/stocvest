"""Tests for :mod:`stocvest.signals.swing_technical_analyzer` (daily-bar swing stack)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.config.signal_parameters import SwingTechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.swing_technical_analyzer import (
    SwingTechnicalAnalyzer,
    _base_formation,
    _higher_highs_lows,
    _macd_momentum_clause,
    _macd_series,
    _rsi_momentum_phase,
    _sma,
    _volume_pattern,
)


def make_daily_bars(
    count: int,
    base_price: float = 100.0,
    trend: float = 0.005,
    volume: float = 5_000_000.0,
) -> list[Bar]:
    bars: list[Bar] = []
    price = base_price
    start = datetime(2023, 1, 3, tzinfo=timezone.utc)
    for i in range(count):
        price = price * (1 + trend)
        o = price * 0.998
        h = price * 1.015
        l = price * 0.985
        c = price
        bars.append(
            Bar(
                symbol="TEST",
                timestamp=start + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=o,
                high=h,
                low=l,
                close=c,
                volume=volume,
            )
        )
    return bars


def test_unavailable_below_60_bars() -> None:
    bars = make_daily_bars(59)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, Snapshot(symbol="TEST"), SwingTechnicalParameters())
    assert r.status == "unavailable"


def test_sma50_calculated_correctly() -> None:
    closes = [float(i) for i in range(1, 251)]
    s = _sma(closes, 50)
    assert s is not None
    assert abs(s - sum(closes[-50:]) / 50) < 1e-6


def test_sma200_calculated_correctly() -> None:
    closes = [100.0 + i * 0.01 for i in range(250)]
    s = _sma(closes, 200)
    assert s is not None
    assert abs(s - sum(closes[-200:]) / 200) < 1e-6


def test_golden_cross_detected() -> None:
    flat = [100.0] * 200
    ramp = [100.0 + i * 2.0 for i in range(50)]
    closes = flat + ramp
    bars = make_daily_bars(len(closes), base_price=100.0, trend=0.0)
    for i, c in enumerate(closes):
        b = bars[i]
        bars[i] = Bar(
            symbol=b.symbol,
            timestamp=b.timestamp,
            timeframe=b.timeframe,
            open=c * 0.999,
            high=c * 1.01,
            low=c * 0.99,
            close=c,
            volume=b.volume,
        )
    snap = Snapshot(symbol="TEST", last_trade_price=closes[-1], prev_close=closes[-2], change_percent=1.0, change=1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.golden_cross is True
    assert any("Golden Cross" in ch for ch in r.chips)


def test_death_cross_detected() -> None:
    high_start = [200.0 - i * 0.5 for i in range(200)]
    drop = [100.0 - i * 0.3 for i in range(50)]
    closes = high_start + drop
    bars = make_daily_bars(len(closes), base_price=100.0, trend=0.0)
    for i, c in enumerate(closes):
        b = bars[i]
        bars[i] = Bar(
            symbol=b.symbol,
            timestamp=b.timestamp,
            timeframe=b.timeframe,
            open=c * 1.001,
            high=c * 1.02,
            low=c * 0.99,
            close=c,
            volume=b.volume,
        )
    snap = Snapshot(symbol="TEST", last_trade_price=closes[-1], prev_close=closes[-2], change_percent=-1.0, change=-1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.golden_cross is False
    assert r.sma50 is not None and r.sma200 is not None and r.sma50 < r.sma200
    assert any("Death Cross" in ch for ch in r.chips)


def test_price_above_sma50_adds_score() -> None:
    bars = make_daily_bars(220, trend=0.02)
    snap = Snapshot(symbol="TEST", last_trade_price=300.0, prev_close=290.0, change_percent=1.0, change=10.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.status == "available"
    assert r.score is not None and r.score > 50


def test_price_below_sma200_reduces_score() -> None:
    up = make_daily_bars(220, trend=0.015)
    # crash last 30 days
    bars = list(up[:-30])
    p = up[-31].close
    for i in range(30):
        p = p * 0.92
        prev = bars[-1]
        ts = prev.timestamp + timedelta(days=1)
        bars.append(
            Bar(
                symbol="TEST",
                timestamp=ts,
                timeframe=Timeframe.DAY_1,
                open=p * 1.01,
                high=p * 1.02,
                low=p * 0.95,
                close=p,
                volume=5e6,
            )
        )
    snap = Snapshot(symbol="TEST", last_trade_price=p, prev_close=p * 1.01, change_percent=-5.0, change=-1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.status == "available"
    assert r.score is not None and r.score < 50


def test_higher_highs_lows_detected() -> None:
    bars = make_daily_bars(80, trend=0.01)
    assert _higher_highs_lows(bars, lookback=20) is True


def test_downtrend_no_higher_highs() -> None:
    bars = make_daily_bars(80, trend=-0.012)
    assert _higher_highs_lows(bars, lookback=20) is False


def test_base_formation_detected() -> None:
    p = make_daily_bars(40, base_price=100.0, trend=0.0)
    bars = []
    for i, b in enumerate(p):
        c = 100.0 + (i % 3) * 0.1
        bars.append(
            Bar(
                symbol=b.symbol,
                timestamp=b.timestamp,
                timeframe=b.timeframe,
                open=c,
                high=c + 0.15,
                low=c - 0.15,
                close=c,
                volume=b.volume,
            )
        )
    params = SwingTechnicalParameters(base_max_range_pct=0.07)
    ok, days, rp = _base_formation(bars, params)
    assert ok is True
    assert days >= params.base_min_days


def test_no_base_when_range_too_wide() -> None:
    bars = make_daily_bars(40, base_price=100.0, trend=0.02)
    params = SwingTechnicalParameters(base_max_range_pct=0.02)
    ok, _, _ = _base_formation(bars, params)
    assert ok is False


def test_accumulation_detected() -> None:
    bars: list[Bar] = []
    start = datetime(2023, 1, 3, tzinfo=timezone.utc)
    base = 100.0
    for i in range(25):
        c = base + i * 0.05
        vol = 6_000_000.0 if i >= 5 else 5_000_000.0
        o = c - 0.1
        # up days with volume > avg later
        bars.append(
            Bar(
                symbol="T",
                timestamp=start + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=o,
                high=c + 0.2,
                low=o - 0.1,
                close=c,
                volume=vol + i * 50_000,
            )
        )
    reg, acc, dist = _volume_pattern(bars, SwingTechnicalParameters(volume_lookback_days=20))
    assert reg == "accumulation" or acc > dist + 2


def test_distribution_detected() -> None:
    bars: list[Bar] = []
    start = datetime(2023, 1, 3, tzinfo=timezone.utc)
    for i in range(25):
        c = 120.0 - i * 0.2
        o = c + 0.15
        vol = 8_000_000.0 + i * 100_000
        bars.append(
            Bar(
                symbol="T",
                timestamp=start + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=o,
                high=o + 0.1,
                low=c - 0.1,
                close=c,
                volume=vol,
            )
        )
    reg, acc, dist = _volume_pattern(bars, SwingTechnicalParameters(volume_lookback_days=20))
    assert reg == "distribution" or dist > acc + 2


def test_macd_bullish_above_signal() -> None:
    closes = [100.0 * (1.003**i) for i in range(160)]
    m, s, _, _, _ = _macd_series(closes)
    assert m is not None and s is not None
    assert m > s + 1e-4


def test_macd_bearish_below_signal() -> None:
    closes = [300.0 - i * 1.1 for i in range(180)]
    m, s, h, _, _ = _macd_series(closes)
    assert m is not None and s is not None and h is not None
    assert abs(h - (m - s)) < 1e-9
    assert m < 0 and s < 0


def test_chips_are_swing_specific() -> None:
    bars = make_daily_bars(210, trend=0.006)
    snap = Snapshot(symbol="TEST", last_trade_price=bars[-1].close, prev_close=bars[-2].close, change_percent=1.0, change=1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    joined = " ".join(r.chips)
    assert "VWAP" not in joined
    assert "ORB" not in joined.upper()
    assert any("SMA50" in ch or "SMA200" in ch for ch in r.chips)


def test_reasoning_mentions_sma_not_vwap() -> None:
    bars = make_daily_bars(210, trend=0.004)
    snap = Snapshot(symbol="TEST", last_trade_price=bars[-1].close, prev_close=bars[-2].close, change_percent=1.0, change=1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    low = r.reasoning.lower()
    assert "sma" in low
    assert "vwap" not in low


def test_strong_bullish_daily_setup() -> None:
    bars = make_daily_bars(210, trend=0.008)
    snap = Snapshot(symbol="TEST", last_trade_price=bars[-1].close, prev_close=bars[-2].close, change_percent=2.0, change=2.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.verdict == "bullish"
    assert r.score is not None and r.score >= 70


def test_rsi_momentum_phase_buckets() -> None:
    p = SwingTechnicalParameters()
    assert _rsi_momentum_phase(55.0, p) == "building"
    assert _rsi_momentum_phase(65.0, p) == "strong"
    assert _rsi_momentum_phase(74.0, p) == "extended"


def test_macd_clause_uses_extended_wording_when_rsi_extended() -> None:
    line = _macd_momentum_clause(phase="extended", macd_above=True, m_now=1.2, s_now=0.4)
    assert "momentum strong but extended" in line
    assert "momentum building" not in line


def test_overbought_and_extension_penalties_reduce_score() -> None:
    """Vertical last bar vs slow ramp — extension + overbought should score below unchecked breakout."""
    bars = make_daily_bars(210, trend=0.003)
    spike = bars[-1].close * 1.65
    last = bars[-1]
    bars[-1] = Bar(
        symbol=last.symbol,
        timestamp=last.timestamp,
        timeframe=last.timeframe,
        open=last.open,
        high=spike * 1.02,
        low=last.low,
        close=spike,
        volume=last.volume * 3,
    )
    snap = Snapshot(symbol="TEST", last_trade_price=spike, prev_close=bars[-2].close, change_percent=16.0, change=10.0)
    mild = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters(rsi_overbought_penalty=0, extension_above_sma50_penalty=0, extension_above_sma200_penalty=0))
    strict = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert mild.score is not None and strict.score is not None
    assert strict.score < mild.score
    assert strict.score <= 90
    assert any("overbought" in ch.lower() for ch in strict.chips)
    assert "extended" in strict.reasoning.lower() or "stretched" in strict.reasoning.lower()


def test_strong_bearish_daily_setup() -> None:
    bars = make_daily_bars(210, trend=-0.02)
    snap = Snapshot(symbol="TEST", last_trade_price=bars[-1].close, prev_close=bars[-2].close, change_percent=-2.0, change=-2.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.verdict == "bearish"
    assert r.score is not None and r.score <= 30


# ---------------------------------------------------------------------------
# D3 — wire-is-live lock-in
# ---------------------------------------------------------------------------
#
# Identical 210-bar uptrend through two different :class:`SwingTechnicalParameters`
# instances: the analyzer must read its scoring contributions and verdict
# thresholds from the params it was passed, not from hardcoded constants.
#
# Note: the default scoring contributions in SwingTechnicalParameters sum to
# more than 100 (20 + 15 + 15 + 15 + 10 + 10 = 85 plus the 50 baseline → 135),
# so any clean uptrend saturates the score at 100. To prove the wire is live
# we either (a) push the bullish threshold beyond the unreachable score, or
# (b) zero out every scoring contribution and toggle one specific bonus.


def test_bullish_threshold_param_actually_drives_verdict() -> None:
    """A clean uptrend scores at the top of the band (clamped to 100); the
    verdict must flip from bullish to neutral when the bullish threshold is
    bumped beyond the score ceiling."""
    bars = make_daily_bars(210, trend=0.008)
    snap = Snapshot(
        symbol="TEST",
        last_trade_price=bars[-1].close,
        prev_close=bars[-2].close,
        change_percent=2.0,
        change=2.0,
    )
    permissive = SwingTechnicalParameters(bullish_threshold=60, bearish_threshold=40)
    strict = SwingTechnicalParameters(bullish_threshold=101, bearish_threshold=0)

    r_permissive = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, permissive)
    r_strict = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, strict)
    assert r_permissive.score == r_strict.score
    assert r_permissive.verdict == "bullish"
    assert r_strict.verdict == "neutral"


def test_above_sma50_score_param_actually_moves_score() -> None:
    """With every scoring contribution zeroed, the score collapses to the
    neutral baseline of 50; raising :attr:`above_sma50_score` to 30 must add
    exactly that bonus on an uptrend where price sits above SMA50. Anything
    other than 50 → 80 means the wire from params is broken or some other
    contribution silently fired."""
    bars = make_daily_bars(210, trend=0.008)
    snap = Snapshot(
        symbol="TEST",
        last_trade_price=bars[-1].close,
        prev_close=bars[-2].close,
        change_percent=2.0,
        change=2.0,
    )
    flat_kwargs = dict(
        rsi_score_delta=0,
        rsi_overbought_penalty=0,
        above_sma50_score=0,
        above_sma200_score=0,
        extension_above_sma50_penalty=0,
        extension_above_sma50_pct=999.0,
        extension_above_sma200_penalty=0,
        extension_above_sma200_pct=999.0,
        higher_highs_lows_score=0,
        volume_accumulation_score=0,
        near_52w_high_score=0,
        base_formation_score=0,
    )
    flat = SwingTechnicalParameters(**flat_kwargs)
    isolated = SwingTechnicalParameters(**{**flat_kwargs, "above_sma50_score": 30})

    baseline = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, flat)
    boosted = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, isolated)
    assert baseline.score == 50
    assert boosted.score == 80
