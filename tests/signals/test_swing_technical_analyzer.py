"""Tests for :mod:`stocvest.signals.swing_technical_analyzer` (daily-bar swing stack)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.config.signal_parameters import SwingTechnicalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.swing_technical_analyzer import (
    SwingTechnicalAnalyzer,
    _base_formation,
    _higher_highs_lows,
    _lower_highs_lows,
    _macd_momentum_clause,
    _macd_series,
    _rate_of_change,
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


def _bars_from_closes(closes: list[float], volume: float = 5_000_000.0) -> list[Bar]:
    start = datetime(2023, 1, 3, tzinfo=timezone.utc)
    return [
        Bar(
            symbol="TEST",
            timestamp=start + timedelta(days=i),
            timeframe=Timeframe.DAY_1,
            open=c,
            high=c * 1.01,
            low=c * 0.99,
            close=c,
            volume=volume,
        )
        for i, c in enumerate(closes)
    ]


def _oversold_downtrend_closes(slope: float, *, fresh_low: bool) -> list[float]:
    """A long uptrend (sets SMA50/200) then a choppy decline into oversold.

    ``fresh_low=True`` ends on a down-bar (today is the recent low → a "knife");
    ``fresh_low=False`` ends on an up-bar (today is *not* the recent low →
    stabilizing). The sawtooth keeps MACD below its signal like a real downtrend.
    """
    peak = 80.0 + 169 * 0.6
    up = [80.0 + i * 0.6 for i in range(170)]
    if fresh_low:
        return up + [peak - i * 1.4 for i in range(1, 56)]
    # range(1, 57) ends on i=56 (even) → an up-bar, so the last close is above the
    # recent sawtooth low while the trend/MACD stay bearish.
    return up + [peak - i * slope + (1.6 if i % 2 == 0 else -1.6) for i in range(1, 57)]


def _snap(closes: list[float]) -> Snapshot:
    return Snapshot(
        symbol="TEST",
        last_trade_price=closes[-1],
        prev_close=closes[-2],
        change_percent=0.0,
        change=0.0,
    )


def test_mean_reversion_floor_lifts_stabilizing_oversold_downtrend() -> None:
    """A confirmed downtrend (below SMA50 & SMA200, MACD<0) that is deeply oversold
    AND no longer making fresh lows is bounce-prone: the mean-reversion floor lifts
    it off the 0 floor into the low-bearish band — but the verdict stays bearish."""
    closes = _oversold_downtrend_closes(1.9, fresh_low=False)
    r = SwingTechnicalAnalyzer().analyze("TEST", _bars_from_closes(closes), _snap(closes), SwingTechnicalParameters())
    assert r.daily_rsi is not None and r.daily_rsi < 30  # deeply oversold
    assert r.sma50 is not None and r.sma200 is not None
    assert closes[-1] < r.sma50 and closes[-1] < r.sma200  # confirmed downtrend
    assert r.mean_reversion_floor_applied is True
    assert r.score is not None and r.score >= 20  # lifted off the floor
    assert r.score < SwingTechnicalParameters().bearish_threshold  # but still bearish
    assert r.verdict == "bearish"
    assert any("bounce" in ch.lower() for ch in r.chips)


def test_mean_reversion_floor_not_applied_to_fresh_low_knife() -> None:
    """A still-falling knife (today is a fresh low) gets NO floor — it must stay
    pinned near zero even though it is below the MAs and oversold."""
    closes = _oversold_downtrend_closes(1.9, fresh_low=True)
    r = SwingTechnicalAnalyzer().analyze("TEST", _bars_from_closes(closes), _snap(closes), SwingTechnicalParameters())
    assert r.daily_rsi is not None and r.daily_rsi < 30
    assert r.mean_reversion_floor_applied is False
    assert r.score is not None and r.score <= 5


def test_mean_reversion_floor_requires_oversold_rsi() -> None:
    """A downtrend that is NOT yet oversold (RSI ≥ threshold) gets no floor — the
    edge is in deep oversold, not every pullback below the MAs."""
    closes = _oversold_downtrend_closes(1.9, fresh_low=False)
    bars = _bars_from_closes(closes)
    # Force the RSI gate shut by pushing the oversold threshold below the RSI.
    params = SwingTechnicalParameters(mean_reversion_oversold_rsi=5.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, _snap(closes), params)
    assert r.mean_reversion_floor_applied is False


def test_mean_reversion_floor_is_capped_below_bearish_threshold() -> None:
    """Even with an absurdly generous floor span, the ceiling keeps the score below
    the bearish threshold so the floor can never flip the verdict to neutral."""
    closes = _oversold_downtrend_closes(1.9, fresh_low=False)
    bars = _bars_from_closes(closes)
    params = SwingTechnicalParameters(mean_reversion_floor_base=200, mean_reversion_floor_span=200)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, _snap(closes), params)
    assert r.mean_reversion_floor_applied is True
    assert r.score is not None and r.score == params.mean_reversion_ceiling
    assert r.score < params.bearish_threshold
    assert r.verdict == "bearish"


def test_mean_reversion_floor_is_non_additive() -> None:
    """The floor is a ``max`` not an addition: a floor lower than the existing score
    leaves the score unchanged (no stacking on top of other terms)."""
    closes = _oversold_downtrend_closes(1.9, fresh_low=False)
    bars = _bars_from_closes(closes)
    low = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, _snap(closes), SwingTechnicalParameters(mean_reversion_floor_base=0, mean_reversion_floor_span=0)
    )
    # base=span=0 → floor resolves to 0, never above the raw trend score → no lift.
    assert low.mean_reversion_floor_applied is False


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
    bars = make_daily_bars(220, trend=0.006)
    snap = Snapshot(
        symbol="TEST",
        last_trade_price=bars[-1].close,
        prev_close=bars[-2].close,
        change_percent=1.0,
        change=1.0,
    )
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


def _durable_uptrend_pullback_bars() -> tuple[list[Bar], Snapshot]:
    """NVDA-like: long uptrend, then a shallow choppy drift that dips below the
    20-day mean but stays above SMA50/SMA200 (golden cross intact)."""
    bars = list(make_daily_bars(210, trend=0.01))
    base = bars[-1].close
    for i in range(16):
        base *= 0.998
        price = base * (1 + (0.015 if i % 2 == 0 else -0.015))
        prev = bars[-1]
        bars.append(
            Bar(
                symbol="TEST",
                timestamp=prev.timestamp + timedelta(days=1),
                timeframe=Timeframe.DAY_1,
                open=base,
                high=price * 1.012,
                low=price * 0.988,
                close=price,
                volume=6_000_000.0,
            )
        )
    last = bars[-1].close
    snap = Snapshot(symbol="TEST", last_trade_price=last, prev_close=bars[-2].close, change_percent=-0.5, change=-1.0)
    return bars, snap


def test_durable_uptrend_credit_is_wired_and_fires() -> None:
    """Structural credit (golden cross + above SMA50/200) must lift a durable
    uptrend pullback: toggling ``golden_cross_score`` moves the score by exactly
    that amount, proving the credit is wired and the pullback is read as
    structure-intact rather than a floored breakdown."""
    bars, snap = _durable_uptrend_pullback_bars()
    last = bars[-1].close
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.golden_cross is True
    assert r.sma50 is not None and r.sma200 is not None
    assert last > r.sma50 and last > r.sma200  # long-term structure intact
    assert r.sma20 is not None and last < r.sma20  # below the short-term mean

    no_credit = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(golden_cross_score=0)
    )
    with_credit = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(golden_cross_score=20)
    )
    assert with_credit.score is not None and no_credit.score is not None
    assert with_credit.score - no_credit.score == 20


def test_below_sma20_penalty_scales_with_distance() -> None:
    """A shallow dip below the 20-day mean must cost far less than a deep break —
    the below-SMA20 penalty is magnitude-scaled, not a flat slab."""
    bars, snap = _durable_uptrend_pullback_bars()
    # Gentle slope (full break only at 100% below) vs steep slope (full at 1%):
    gentle = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(below_sma20_full_break_pct=100.0)
    )
    steep = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(below_sma20_full_break_pct=1.0)
    )
    assert gentle.score is not None and steep.score is not None
    assert gentle.score > steep.score


def test_negative_macd_not_double_penalized_by_fading() -> None:
    """A negative MACD histogram is penalized once. The fading penalty only
    applies while the histogram is still positive (early rollover), so changing
    its size must not move the score on a name whose histogram is already < 0."""
    high_start = [200.0 - i * 0.4 for i in range(180)]
    drop = [120.0 - i * 0.6 for i in range(40)]
    closes = high_start + drop
    bars = make_daily_bars(len(closes), base_price=100.0, trend=0.0)
    for i, c in enumerate(closes):
        b = bars[i]
        bars[i] = Bar(
            symbol=b.symbol,
            timestamp=b.timestamp,
            timeframe=b.timeframe,
            open=c * 1.001,
            high=c * 1.01,
            low=c * 0.99,
            close=c,
            volume=b.volume,
        )
    snap = Snapshot(symbol="TEST", last_trade_price=closes[-1], prev_close=closes[-2], change_percent=-1.0, change=-1.0)
    light = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(macd_histogram_fading_penalty=0)
    )
    heavy = SwingTechnicalAnalyzer().analyze(
        "TEST", bars, snap, SwingTechnicalParameters(macd_histogram_fading_penalty=40)
    )
    assert light.score is not None and heavy.score is not None
    assert light.score == heavy.score


def test_breakdown_from_recent_high_scores_bearish_not_extended_bullish() -> None:
    """DELL-like: long uptrend then sharp ~16% drop — must not read bullish 77."""
    up = make_daily_bars(200, trend=0.008)
    bars = list(up)
    price = bars[-1].close
    for _ in range(10):
        price *= 0.982
        prev = bars[-1]
        bars.append(
            Bar(
                symbol="TEST",
                timestamp=prev.timestamp + timedelta(days=1),
                timeframe=Timeframe.DAY_1,
                open=price * 1.01,
                high=price * 1.02,
                low=price * 0.97,
                close=price,
                volume=6_000_000.0,
            )
        )
    snap = Snapshot(symbol="TEST", last_trade_price=price, prev_close=bars[-2].close, change_percent=-3.0, change=-1.0)
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, SwingTechnicalParameters())
    assert r.status == "available"
    assert r.score is not None and r.score <= 45
    assert r.verdict in ("bearish", "neutral")
    closes = [b.close for b in bars]
    roc = _rate_of_change(closes, 10)
    assert roc is not None and roc < -0.05
    assert _lower_highs_lows(bars, 20) or r.score <= 40


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
        rsi_exhaustion_extended_penalty=0,
        above_sma20_score=0,
        below_sma20_score=0,
        sma20_extended_penalty=0,
        sma20_extended_pct=999.0,
        above_sma50_score=0,
        above_sma200_score=0,
        golden_cross_score=0,
        below_sma20_min_penalty=0,
        volume_distribution_penalty=0,
        extension_above_sma50_penalty=0,
        extension_above_sma50_pct=999.0,
        extension_above_sma200_penalty=0,
        extension_above_sma200_pct=999.0,
        extension_extra_per_10_pct=0,
        extension_penalty_cap=0,
        roc_strong_score=0,
        roc_moderate_score=0,
        pct_from_high_strong_penalty=0,
        pct_from_high_moderate_penalty=0,
        higher_highs_lows_score=0,
        lower_highs_lows_score=0,
        macd_histogram_positive_score=0,
        macd_histogram_negative_penalty=0,
        macd_histogram_fading_penalty=0,
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


def _golden_cross_then_crash_closes() -> list[float]:
    """A long uptrend (SMA50 ends well above SMA200 → golden cross) followed by a
    sharp crash that drops price below all key MAs — like SPCH ($28 → ~$12, 50>200
    still true but lagging). RSI lands ~mid-30s (not deeply oversold) so the B73
    bounce floor does not apply."""
    up = [10.0 + (28.0 - 10.0) * (i / 219.0) for i in range(220)]
    crash = [28.0 * (0.94 ** k) for k in range(1, 15)]  # ~ -57% over 14 sessions
    return up + crash


def test_lagging_golden_cross_not_labeled_uptrend_on_breakdown() -> None:
    """A stale 50>200 cross on a stock that has broken below both MAs must read as
    BROKEN structure (chip 'Golden Cross (lagging)'), not bullish 'uptrend' — and the
    bearish score is unchanged (display-only fix)."""
    closes = _golden_cross_then_crash_closes()
    r = SwingTechnicalAnalyzer().analyze("TEST", _bars_from_closes(closes), _snap(closes), SwingTechnicalParameters())
    assert r.sma50 is not None and r.sma200 is not None
    assert r.sma50 > r.sma200  # golden cross present
    assert closes[-1] < r.sma50 and closes[-1] < r.sma200  # but price below both
    assert r.verdict == "bearish"
    # Chip is qualified, never the bare bullish "Golden Cross".
    assert "Golden Cross (lagging)" in r.chips
    assert "Golden Cross" not in r.chips
    # Brief says broken, not uptrend.
    assert "broken structure" in r.reasoning
    assert "uptrend structure" not in r.reasoning
    assert "lagging" in r.reasoning


def test_lagging_golden_cross_contributes_zero_score_credit() -> None:
    """Pins the score gate behind the label fix: when price has broken below both
    MAs the golden-cross structural credit must NOT fire, so the final score is
    invariant to ``golden_cross_score`` (the credit is gated on ``durable_uptrend``
    = price above both MAs, not the raw 50>200 cross). SPCH live: raw pre-clamp -42,
    clamped to 0 regardless of the credit param."""
    from dataclasses import replace

    closes = _golden_cross_then_crash_closes()
    bars = _bars_from_closes(closes)
    snap = _snap(closes)
    base = SwingTechnicalParameters()
    no_credit = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, replace(base, golden_cross_score=0))
    huge_credit = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, replace(base, golden_cross_score=200))
    assert no_credit.score == huge_credit.score  # credit does not enter the math
    assert huge_credit.verdict == "bearish"


def test_durable_uptrend_keeps_plain_golden_cross_and_uptrend_label() -> None:
    """A genuine uptrend (price above both MAs, 50>200) still reads as uptrend with a
    plain 'Golden Cross' chip — the fix must not regress healthy names."""
    bars = make_daily_bars(260, base_price=10.0, trend=0.005)
    closes = [b.close for b in bars]
    r = SwingTechnicalAnalyzer().analyze("TEST", bars, _snap(closes), SwingTechnicalParameters())
    assert r.sma50 is not None and r.sma200 is not None
    assert closes[-1] > r.sma50 and closes[-1] > r.sma200  # durable uptrend
    assert "Golden Cross" in r.chips
    assert "Golden Cross (lagging)" not in r.chips
    assert "uptrend structure" in r.reasoning
