"""
Phase 2.5a: Pre-market gap scanner.

Identifies symbols with meaningful pre-market gaps and ranks them as
day-trading candidates.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.indicators.core import OpeningRange, gap_percent, opening_range


@dataclass(frozen=True)
class PremarketGapCandidate:
    symbol: str
    prev_close: float
    premarket_price: float
    gap_percent: float
    day_volume: float
    direction: str  # "up" or "down"
    rank_score: float


class PremarketGapScanner:
    """
    Scan snapshots for gapping symbols.

    Default rule from context:
      - gap threshold: absolute gap > 2%
    """

    def __init__(
        self,
        *,
        min_abs_gap_percent: float = 2.0,
        min_day_volume: float = 0.0,
    ) -> None:
        self._min_abs_gap_percent = min_abs_gap_percent
        self._min_day_volume = min_day_volume

    def scan_snapshots(
        self,
        snapshots: list[Snapshot],
        *,
        limit: int = 8,
    ) -> list[PremarketGapCandidate]:
        """
        Return top ranked gap candidates.

        Ranking favors larger absolute gaps with a modest volume factor.
        """
        candidates: list[PremarketGapCandidate] = []
        for snapshot in snapshots:
            candidate = self._to_candidate(snapshot)
            if candidate is None:
                continue
            if abs(candidate.gap_percent) < self._min_abs_gap_percent:
                continue
            if candidate.day_volume < self._min_day_volume:
                continue
            candidates.append(candidate)

        candidates.sort(key=lambda c: c.rank_score, reverse=True)
        return candidates[: max(0, limit)]

    def _to_candidate(self, snapshot: Snapshot) -> PremarketGapCandidate | None:
        prev_close = snapshot.prev_close
        premarket_price = self._resolve_premarket_price(snapshot)
        if prev_close is None or prev_close <= 0 or premarket_price is None or premarket_price <= 0:
            return None

        gp = gap_percent(prev_close, premarket_price)
        day_volume = float(snapshot.day_volume or 0.0)
        direction = "up" if gp >= 0 else "down"

        # Keep score bounded and interpretable; avoid over-dominating by raw volume.
        volume_factor = min(2.0, 1.0 + (day_volume / 50_000_000))
        rank_score = abs(gp) * volume_factor

        return PremarketGapCandidate(
            symbol=snapshot.symbol,
            prev_close=prev_close,
            premarket_price=premarket_price,
            gap_percent=gp,
            day_volume=day_volume,
            direction=direction,
            rank_score=round(rank_score, 4),
        )

    @staticmethod
    def _resolve_premarket_price(snapshot: Snapshot) -> float | None:
        return (
            snapshot.pre_market_price
            if snapshot.pre_market_price is not None
            else snapshot.last_trade_price
        )


@dataclass(frozen=True)
class VWAPUpdate:
    symbol: str
    date_key: str
    vwap: float | None
    cumulative_volume: float


class IntradayVWAPCalculator:
    """
    Real-time intraday VWAP calculator with per-symbol, per-day state.

    VWAP resets automatically when a new trading day is observed for a symbol.
    """

    def __init__(self) -> None:
        self._state: dict[str, dict[str, float | str]] = {}

    def update(self, bar: Bar) -> VWAPUpdate:
        date_key = bar.timestamp.date().isoformat()
        state = self._state.get(bar.symbol)

        if state is None or state["date_key"] != date_key:
            state = {
                "date_key": date_key,
                "cum_tpv": 0.0,
                "cum_vol": 0.0,
            }
            self._state[bar.symbol] = state

        typical = (bar.high + bar.low + bar.close) / 3.0
        state["cum_tpv"] = float(state["cum_tpv"]) + (typical * bar.volume)
        state["cum_vol"] = float(state["cum_vol"]) + bar.volume

        cum_vol = float(state["cum_vol"])
        if cum_vol <= 0:
            vwap = None
        else:
            vwap = round(float(state["cum_tpv"]) / cum_vol, 4)

        return VWAPUpdate(
            symbol=bar.symbol,
            date_key=date_key,
            vwap=vwap,
            cumulative_volume=cum_vol,
        )

    def get_current_vwap(self, symbol: str) -> float | None:
        state = self._state.get(symbol)
        if state is None:
            return None
        cum_vol = float(state["cum_vol"])
        if cum_vol <= 0:
            return None
        return round(float(state["cum_tpv"]) / cum_vol, 4)


@dataclass(frozen=True)
class OpeningRangeBreakoutSignal:
    symbol: str
    direction: str  # "long" or "short"
    breakout_price: float
    breakout_time_iso: str
    range_high: float
    range_low: float
    range_midpoint: float
    strength: float  # 0.0 - 1.0
    volume_confirmed: bool


class OpeningRangeBreakoutDetector:
    """
    Detect opening-range breakouts (ORB) on 1-minute bars.

    - Opening range is computed from first `opening_range_minutes` bars.
    - Breakout is signaled when a later close crosses above range high (long)
      or below range low (short) by at least `breakout_buffer_pct`.
    """

    def __init__(
        self,
        *,
        opening_range_minutes: int = 15,
        breakout_buffer_pct: float = 0.05,  # 0.05% default buffer
        min_volume_for_confirmation: float = 0.0,
    ) -> None:
        self._opening_range_minutes = opening_range_minutes
        self._breakout_buffer_pct = breakout_buffer_pct
        self._min_volume_for_confirmation = min_volume_for_confirmation

    def detect(self, bars: list[Bar]) -> OpeningRangeBreakoutSignal | None:
        if not bars:
            return None

        first_symbol = bars[0].symbol
        if any(bar.symbol != first_symbol for bar in bars):
            raise ValueError("All bars must belong to the same symbol for ORB detection.")

        orb: OpeningRange | None = opening_range(bars, minutes=self._opening_range_minutes)
        if orb is None:
            return None

        eval_bars = bars[self._opening_range_minutes :]
        if not eval_bars:
            return None

        upper_trigger = orb.high * (1 + (self._breakout_buffer_pct / 100.0))
        lower_trigger = orb.low * (1 - (self._breakout_buffer_pct / 100.0))

        for bar in eval_bars:
            volume_confirmed = bar.volume >= self._min_volume_for_confirmation
            if bar.close >= upper_trigger:
                return OpeningRangeBreakoutSignal(
                    symbol=bar.symbol,
                    direction="long",
                    breakout_price=bar.close,
                    breakout_time_iso=bar.timestamp.isoformat(),
                    range_high=orb.high,
                    range_low=orb.low,
                    range_midpoint=orb.midpoint,
                    strength=self._strength(bar.close, orb.midpoint),
                    volume_confirmed=volume_confirmed,
                )
            if bar.close <= lower_trigger:
                return OpeningRangeBreakoutSignal(
                    symbol=bar.symbol,
                    direction="short",
                    breakout_price=bar.close,
                    breakout_time_iso=bar.timestamp.isoformat(),
                    range_high=orb.high,
                    range_low=orb.low,
                    range_midpoint=orb.midpoint,
                    strength=self._strength(bar.close, orb.midpoint),
                    volume_confirmed=volume_confirmed,
                )
        return None

    @staticmethod
    def _strength(price: float, midpoint: float) -> float:
        if midpoint == 0:
            return 0.0
        return min(1.0, abs((price - midpoint) / midpoint))


@dataclass(frozen=True)
class EMAUpdate:
    symbol: str
    date_key: str
    ema9: float | None
    close: float
    bars_seen_today: int


class IntradayEMA9Calculator:
    """
    Stateful 9 EMA calculator for 1-minute bars.

    - Resets automatically per symbol when trading day changes.
    - Returns None until enough bars exist to seed EMA(9) with SMA(9).
    """

    def __init__(self, *, period: int = 9) -> None:
        if period < 1:
            raise ValueError("EMA period must be >= 1.")
        self._period = period
        self._k = 2.0 / (period + 1)
        self._state: dict[str, dict[str, object]] = {}

    def update(self, bar: Bar) -> EMAUpdate:
        if bar.timeframe != Timeframe.MIN_1:
            raise ValueError("IntradayEMA9Calculator requires 1-minute bars.")

        date_key = bar.timestamp.date().isoformat()
        state = self._state.get(bar.symbol)
        if state is None or state["date_key"] != date_key:
            state = {
                "date_key": date_key,
                "seed_closes": deque(maxlen=self._period),
                "bars_seen": 0,
                "ema": None,
            }
            self._state[bar.symbol] = state

        seed_closes = state["seed_closes"]
        assert isinstance(seed_closes, deque)
        seed_closes.append(float(bar.close))
        state["bars_seen"] = int(state["bars_seen"]) + 1

        ema = state["ema"]
        if ema is None:
            if len(seed_closes) < self._period:
                ema_out = None
            else:
                seeded = sum(seed_closes) / self._period
                state["ema"] = seeded
                ema_out = round(seeded, 4)
        else:
            assert isinstance(ema, float)
            nxt = (float(bar.close) * self._k) + (ema * (1 - self._k))
            state["ema"] = nxt
            ema_out = round(nxt, 4)

        return EMAUpdate(
            symbol=bar.symbol,
            date_key=date_key,
            ema9=ema_out,
            close=float(bar.close),
            bars_seen_today=int(state["bars_seen"]),
        )

    def get_current_ema(self, symbol: str) -> float | None:
        state = self._state.get(symbol)
        if state is None:
            return None
        ema = state.get("ema")
        if ema is None:
            return None
        assert isinstance(ema, float)
        return round(ema, 4)


@dataclass(frozen=True)
class IntradaySetupCandidate:
    symbol: str
    direction: str  # "long" or "short"
    score: float
    triggers: list[str]
    last_price: float
    vwap: float | None
    ema9: float | None
    timestamp_iso: str


class IntradaySetupScanner:
    """
    Scan intraday bars and rank actionable setups every cycle (e.g. every 5 min).

    Signals considered:
      - Opening range breakout direction
      - VWAP reclaim / rejection
      - 9 EMA bounce / rejection
      - High-of-day / low-of-day breakout
      - Volume surge confirmation
    """

    def __init__(
        self,
        *,
        opening_range_minutes: int = 15,
        breakout_buffer_pct: float = 0.05,
        min_score: float = 0.35,
    ) -> None:
        self._min_score = min_score
        self._orb = OpeningRangeBreakoutDetector(
            opening_range_minutes=opening_range_minutes,
            breakout_buffer_pct=breakout_buffer_pct,
        )

    def scan(
        self,
        bars_by_symbol: dict[str, list[Bar]],
        *,
        limit: int = 8,
    ) -> list[IntradaySetupCandidate]:
        results: list[IntradaySetupCandidate] = []
        for symbol, bars in bars_by_symbol.items():
            candidate = self._scan_symbol(symbol, bars)
            if candidate is not None:
                results.append(candidate)

        results.sort(key=lambda c: c.score, reverse=True)
        return results[: max(0, limit)]

    def _scan_symbol(self, symbol: str, bars: list[Bar]) -> IntradaySetupCandidate | None:
        if len(bars) < 10:
            return None
        if any(bar.symbol != symbol for bar in bars):
            return None
        if any(bar.timeframe != Timeframe.MIN_1 for bar in bars):
            return None

        latest = bars[-1]
        prev = bars[-2]
        avg_recent_volume = sum(bar.volume for bar in bars[-10:]) / min(10, len(bars))
        volume_surge = latest.volume >= max(1.0, avg_recent_volume * 1.5)

        # Run per-symbol intraday indicators on this bar slice only.
        vwap_calc = IntradayVWAPCalculator()
        prev_vwap: float | None = None
        latest_vwap: float | None = None
        for bar in bars:
            latest_vwap = vwap_calc.update(bar).vwap
            if bar is prev:
                prev_vwap = latest_vwap

        ema_calc = IntradayEMA9Calculator()
        prev_ema: float | None = None
        latest_ema: float | None = None
        for bar in bars:
            latest_ema = ema_calc.update(bar).ema9
            if bar is prev:
                prev_ema = latest_ema

        orb = self._orb.detect(bars)
        prior_high = max(bar.high for bar in bars[:-1])
        prior_low = min(bar.low for bar in bars[:-1])

        long_triggers: list[str] = []
        short_triggers: list[str] = []
        long_score = 0.0
        short_score = 0.0

        if orb is not None:
            if orb.direction == "long":
                long_triggers.append("orb_breakout_long")
                long_score += 0.35
            elif orb.direction == "short":
                short_triggers.append("orb_breakout_short")
                short_score += 0.35

        if prev_vwap is not None and latest_vwap is not None:
            if prev.close < prev_vwap and latest.close > latest_vwap:
                long_triggers.append("vwap_reclaim")
                long_score += 0.2
            if prev.close > prev_vwap and latest.close < latest_vwap:
                short_triggers.append("vwap_rejection")
                short_score += 0.2

        if prev_ema is not None and latest_ema is not None:
            if latest.low <= latest_ema and latest.close > latest_ema and latest.close >= prev.close:
                long_triggers.append("ema9_bounce")
                long_score += 0.2
            if latest.high >= latest_ema and latest.close < latest_ema and latest.close <= prev.close:
                short_triggers.append("ema9_rejection")
                short_score += 0.2

        if latest.close > prior_high:
            long_triggers.append("hod_breakout")
            long_score += 0.15
        if latest.close < prior_low:
            short_triggers.append("lod_breakdown")
            short_score += 0.15

        if volume_surge:
            if long_score >= short_score and long_score > 0:
                long_triggers.append("volume_surge")
                long_score += 0.1
            elif short_score > 0:
                short_triggers.append("volume_surge")
                short_score += 0.1

        if long_score >= short_score:
            score = round(min(1.0, long_score), 4)
            if score < self._min_score:
                return None
            return IntradaySetupCandidate(
                symbol=symbol,
                direction="long",
                score=score,
                triggers=long_triggers,
                last_price=latest.close,
                vwap=latest_vwap,
                ema9=latest_ema,
                timestamp_iso=latest.timestamp.isoformat(),
            )

        score = round(min(1.0, short_score), 4)
        if score < self._min_score:
            return None
        return IntradaySetupCandidate(
            symbol=symbol,
            direction="short",
            score=score,
            triggers=short_triggers,
            last_price=latest.close,
            vwap=latest_vwap,
            ema9=latest_ema,
            timestamp_iso=latest.timestamp.isoformat(),
        )
