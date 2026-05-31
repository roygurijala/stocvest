"""Two-layer reference stop: session structure anchor + ATR floor (Python twin of reference-stop-resolve.ts)."""

from __future__ import annotations

from typing import Literal

TradingMode = Literal["day", "swing"]
PresetId = Literal["continuation", "dip", "breakout"]
Direction = Literal["bullish", "bearish"]

ATR_K_BY_PRESET: dict[str, float] = {
    "dip": 0.75,
    "continuation": 1.0,
    "breakout": 1.25,
}


def _round4(n: float) -> float:
    return round(n, 4)


def reference_stop_atr_k(
    *,
    trading_mode: TradingMode | None = None,
    preset: PresetId | None = None,
) -> float:
    if preset is not None:
        return ATR_K_BY_PRESET[preset]
    if trading_mode == "day":
        return 0.85
    return 1.0


def resolve_structural_stop_anchor(
    *,
    direction: Direction,
    session_low: float | None,
    session_high: float | None,
    vwap: float | None,
    prev_close: float | None,
    last: float | None,
    swing_low: float | None = None,
    swing_high: float | None = None,
) -> float | None:
    session_lo: float | None = None
    if session_low is not None and session_low > 0:
        session_lo = float(session_low)
        if swing_low is not None and swing_low > 0:
            session_lo = min(session_lo, float(swing_low))
    elif swing_low is not None and swing_low > 0:
        session_lo = float(swing_low)

    session_hi: float | None = None
    if session_high is not None and session_high > 0:
        session_hi = float(session_high)
        if swing_high is not None and swing_high > 0:
            session_hi = max(session_hi, float(swing_high))
    elif swing_high is not None and swing_high > 0:
        session_hi = float(swing_high)

    if direction == "bullish":
        if session_lo is not None and vwap is not None and vwap > 0:
            return _round4(min(session_lo, float(vwap)) * 0.998)
        if session_lo is not None:
            return _round4(session_lo * 0.995)
        if vwap is not None and vwap > 0:
            return _round4(float(vwap) * 0.995)
        if prev_close is not None and prev_close > 0:
            return _round4(float(prev_close) * 0.99)
        if last is not None and last > 0:
            return _round4(float(last) * 0.98)
        return None

    if session_hi is not None and vwap is not None and vwap > 0:
        return _round4(max(session_hi, float(vwap)) * 1.002)
    if session_hi is not None:
        return _round4(session_hi * 1.005)
    if vwap is not None and vwap > 0:
        return _round4(float(vwap) * 1.005)
    if prev_close is not None and prev_close > 0:
        return _round4(float(prev_close) * 1.01)
    if last is not None and last > 0:
        return _round4(float(last) * 1.02)
    return None


def _min_stop_distance_usd(entry: float, atr: float | None) -> float:
    if entry <= 0:
        return 0.1
    atr_floor = atr * 0.5 if atr is not None and atr > 0 else 0.0
    if entry >= 200:
        price_floor = 1.25
    elif entry >= 50:
        price_floor = 0.75
    elif entry >= 10:
        price_floor = 0.35
    else:
        price_floor = max(0.08, entry * 0.025)
    return max(atr_floor, price_floor)


def _apply_min_stop_distance(
    direction: Direction,
    entry: float,
    stop: float,
    atr: float | None,
) -> float:
    min_dist = _min_stop_distance_usd(entry, atr)
    if direction == "bullish":
        if stop >= entry:
            return _round4(entry - min_dist)
        if entry - stop < min_dist:
            return _round4(entry - min_dist)
        return _round4(stop)
    if stop <= entry:
        return _round4(entry + min_dist)
    if stop - entry < min_dist:
        return _round4(entry + min_dist)
    return _round4(stop)


def resolve_merged_reference_stop(
    *,
    direction: Direction,
    entry: float,
    structural_stop: float | None,
    atr: float | None,
    atr_k: float,
) -> tuple[float | None, bool]:
    """Returns (stop, used_atr_floor)."""
    structural = (
        _round4(float(structural_stop))
        if structural_stop is not None and structural_stop > 0
        else None
    )
    if entry <= 0:
        return structural, False

    atr_stop: float | None = None
    if atr is not None and atr > 0 and atr_k > 0:
        atr_stop = (
            _round4(entry - atr_k * float(atr))
            if direction == "bullish"
            else _round4(entry + atr_k * float(atr))
        )

    merged = structural
    used_atr_floor = False
    if structural is not None and atr_stop is not None:
        if direction == "bullish":
            merged = _round4(min(structural, atr_stop))
            used_atr_floor = merged < structural - 1e-8
        else:
            merged = _round4(max(structural, atr_stop))
            used_atr_floor = merged > structural + 1e-8
    elif structural is None and atr_stop is not None:
        merged = atr_stop
        used_atr_floor = True

    if merged is None:
        return None, False

    return _apply_min_stop_distance(direction, entry, merged, atr), used_atr_floor


def format_merged_stop_provenance(base_label: str, *, atr_k: float, used_atr_floor: bool) -> str:
    base = (base_label or "Structural stop").strip()
    if not used_atr_floor:
        return base
    return f"{base}; widened to {atr_k}×ATR14 floor"
