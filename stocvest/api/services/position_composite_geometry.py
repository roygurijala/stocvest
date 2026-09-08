"""Position-desk composite geometry — weekly ATR stops and structural T1/T2 (POS-D5)."""

from __future__ import annotations

import statistics
from typing import Any

from stocvest.api.services.entry_zone import resolve_structure_zone_level
from stocvest.api.services.geometry_tradeability import geometry_tradeability
from stocvest.api.services.market_environment import min_risk_reward_from_environment
from stocvest.api.services.position_reference_stop_policy import (
    POSITION_T2_ATR_BETA,
    format_merged_stop_provenance,
    position_reference_stop_atr_k,
    resolve_position_merged_reference_stop,
)
from stocvest.api.services.reference_stop_policy import resolve_structural_stop_anchor
from stocvest.api.services.risk_reward_structure import (
    round_risk_reward_display,
    rr_from_levels_long,
    rr_from_levels_short,
    structure_risk_reward_for_mode,
)
from stocvest.api.services.target_geometry import compute_long_geometry, compute_short_geometry, distance_in_atr
from stocvest.data.models import Bar, Snapshot
from stocvest.indicators.core import atr as atr_series
from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict
from stocvest.signals.direction_confidence import assess_direction_confidence
from stocvest.signals.position_technical_analyzer import (
    PositionTechnicalLayerResult,
    aggregate_daily_to_weekly_bars,
)

_TINY = 1e-6
_TRADING_MODE = "position"


def _bars_to_ohlc_dicts(bars: list[Bar]) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    for bar in bars:
        lo, hi = float(bar.low), float(bar.high)
        if lo <= 0 or hi <= 0 or hi < lo:
            continue
        out.append(
            {
                "low": lo,
                "high": hi,
                "close": float(bar.close),
                "open": float(bar.open),
            }
        )
    return out


def compute_weekly_atr(weekly_bars: list[Bar], *, period: int = 14) -> float | None:
    if len(weekly_bars) < period + 1:
        return None
    series = atr_series(weekly_bars, period=period)
    for value in reversed(series):
        if value is not None and float(value) > 0:
            return float(value)
    return None


def _snap_price(snapshot: Snapshot | None) -> float | None:
    if snapshot is None:
        return None
    for attr in ("last_trade_price", "day_close", "prev_close"):
        raw = getattr(snapshot, attr, None)
        if raw is not None and float(raw) > 0:
            return float(raw)
    return None


def _weekly_range(weekly_bars: list[Bar], lookback_weeks: int = 52) -> tuple[float | None, float | None]:
    if not weekly_bars:
        return None, None
    chunk = sorted(weekly_bars, key=lambda b: b.timestamp)[-lookback_weeks:]
    if not chunk:
        return None, None
    return min(float(b.low) for b in chunk), max(float(b.high) for b in chunk)


def _use_long_geometry(
    verdict: CompositeVerdict,
    range_lo: float | None,
    range_hi: float | None,
    last: float | None,
) -> bool:
    if verdict == CompositeVerdict.BULLISH:
        return True
    if verdict == CompositeVerdict.BEARISH:
        return False
    if range_lo is not None and range_hi is not None and range_hi > range_lo and last is not None and last > 0:
        mid = (range_lo + range_hi) / 2.0
        return float(last) >= mid
    return True


def _analyst_median_target(levels: list[float] | None, *, entry: float, use_long: bool) -> float | None:
    if not levels:
        return None
    valid = sorted({round(float(x), 4) for x in levels if isinstance(x, (int, float)) and float(x) > 0})
    if not valid:
        return None
    med = round(float(statistics.median(valid)), 4)
    if use_long and med > entry + _TINY:
        return med
    if not use_long and med < entry - _TINY:
        return med
    return None


def _position_entry_zone(
    *,
    last: float,
    weekly_sma50: float | None,
    range_lo: float | None,
    range_hi: float | None,
) -> dict[str, float]:
    anchor = weekly_sma50 if weekly_sma50 is not None and weekly_sma50 > 0 else last
    width_pct = 0.04
    lo = round(min(anchor * (1.0 - width_pct), last * 0.985), 4)
    hi = round(max(anchor * (1.0 + width_pct * 0.5), last * 0.995), 4)
    if range_lo is not None and range_hi is not None and range_hi > range_lo:
        lo = round(max(lo, range_lo), 4)
        hi = round(min(hi, range_hi), 4)
    if hi <= lo:
        lo = round(last * 0.97, 4)
        hi = round(last * 1.01, 4)
    return {"low": lo, "high": hi}


def _entry_for_geometry(last: float, entry_zone: dict[str, float]) -> float:
    """Reference entry for stop/target/R/R — prefer last (matches swing + gate math)."""
    if last > 0:
        return round(float(last), 4)
    lo = float(entry_zone.get("low") or 0)
    hi = float(entry_zone.get("high") or 0)
    if hi > lo > 0:
        return round((lo + hi) / 2.0, 4)
    return round(float(last), 4)


def _position_signal_complete(
    signal: dict[str, Any],
    *,
    rr_struct: float | None,
    min_rr: float,
) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not signal.get("historical_entry_zone"):
        missing.append("entry_zone")
    if signal.get("reference_stop_level") is None:
        missing.append("stop_level")
    if signal.get("reference_target_1") is None:
        missing.append("target_1")
    if rr_struct is None:
        missing.append("risk_reward")
    elif float(rr_struct) < float(min_rr):
        missing.append("risk_reward_below_min")
    return len(missing) == 0, missing


def _long_geometry(
    *,
    last: float,
    entry: float,
    weekly_atr: float,
    weekly_bars_dict: list[dict[str, float]],
    range_lo: float | None,
    range_hi: float | None,
    weekly_sma50: float | None,
    weekly_sma200: float | None,
    analyst_levels: list[float] | None,
    analyst_target_source: str | None = None,
) -> tuple[float | None, float | None, float | None, bool, str | None, str, str | None]:
    structure_lo = resolve_structure_zone_level(
        direction="long",
        last=last,
        atr=weekly_atr,
        daily_bars=weekly_bars_dict,
        trading_mode=_TRADING_MODE,
        sma50=weekly_sma50,
        day_lo=range_lo,
    )
    structural = resolve_structural_stop_anchor(
        direction="bullish",
        session_low=range_lo,
        session_high=range_hi,
        vwap=None,
        prev_close=None,
        last=last,
        swing_low=range_lo,
        zone_lo=structure_lo,
    )
    stop, used_atr = resolve_position_merged_reference_stop(
        direction="bullish",
        entry=entry,
        structural_stop=structural,
        atr=weekly_atr,
    )
    stop_label = "Weekly structure support"
    if structure_lo is not None:
        stop_label = "Structure-engine support zone"

    geo = compute_long_geometry(
        entry=entry,
        atr=weekly_atr,
        stop=stop,
        daily_bars=weekly_bars_dict,
        trading_mode=_TRADING_MODE,
        day_hi=range_hi,
        sma50=weekly_sma50,
        sma200=weekly_sma200,
    )
    t1 = geo.target_1
    t2 = geo.target_2
    t2_prov: str | None = geo.target_2_provenance

    analyst_t2 = (
        _analyst_median_target(analyst_levels, entry=entry, use_long=True)
        if str(analyst_target_source or "").strip().lower() == "benzinga"
        else None
    )
    candidates: list[tuple[float, str]] = []
    if t2 is not None and t2 > (t1 or 0) + _TINY:
        candidates.append((t2, t2_prov or "resistance"))
    if analyst_t2 is not None and (t1 is None or analyst_t2 > t1 + _TINY):
        candidates.append((analyst_t2, "analyst_target"))
    atr_ext = round(entry + POSITION_T2_ATR_BETA * weekly_atr, 4)
    if atr_ext > (t1 or 0) + _TINY:
        candidates.append((atr_ext, "atr_extension"))
    if candidates:
        t2, t2_prov = min(candidates, key=lambda row: row[0])

    t1_label = "Structural resistance (weekly)" if geo.target_1_source == "structural" else "Weekly ATR floor"
    return stop, t1, t2, used_atr, t2_prov, stop_label, t1_label


def _short_geometry(
    *,
    last: float,
    entry: float,
    weekly_atr: float,
    weekly_bars_dict: list[dict[str, float]],
    range_lo: float | None,
    range_hi: float | None,
    weekly_sma50: float | None,
    weekly_sma200: float | None,
    analyst_levels: list[float] | None,
    analyst_target_source: str | None = None,
) -> tuple[float | None, float | None, float | None, bool, str | None, str, str | None]:
    structure_hi = resolve_structure_zone_level(
        direction="short",
        last=last,
        atr=weekly_atr,
        daily_bars=weekly_bars_dict,
        trading_mode=_TRADING_MODE,
        sma50=weekly_sma50,
        day_hi=range_hi,
    )
    structural = resolve_structural_stop_anchor(
        direction="bearish",
        session_low=range_lo,
        session_high=range_hi,
        vwap=None,
        prev_close=None,
        last=last,
        swing_high=range_hi,
        zone_hi=structure_hi,
    )
    stop, used_atr = resolve_position_merged_reference_stop(
        direction="bearish",
        entry=entry,
        structural_stop=structural,
        atr=weekly_atr,
    )
    stop_label = "Weekly structure resistance"
    if structure_hi is not None:
        stop_label = "Structure-engine resistance zone"

    geo = compute_short_geometry(
        entry=entry,
        atr=weekly_atr,
        stop=stop,
        daily_bars=weekly_bars_dict,
        trading_mode=_TRADING_MODE,
        day_lo=range_lo,
        sma50=weekly_sma50,
        sma200=weekly_sma200,
    )
    t1 = geo.target_1
    t2 = geo.target_2
    t2_prov: str | None = geo.target_2_provenance

    analyst_t2 = (
        _analyst_median_target(analyst_levels, entry=entry, use_long=False)
        if str(analyst_target_source or "").strip().lower() == "benzinga"
        else None
    )
    candidates: list[tuple[float, str]] = []
    if t2 is not None and (t1 is None or t2 < t1 - _TINY):
        candidates.append((t2, t2_prov or "resistance"))
    if analyst_t2 is not None and (t1 is None or analyst_t2 < t1 - _TINY):
        candidates.append((analyst_t2, "analyst_target"))
    atr_ext = round(entry - POSITION_T2_ATR_BETA * weekly_atr, 4)
    if t1 is None or atr_ext < t1 - _TINY:
        candidates.append((atr_ext, "atr_extension"))
    if candidates:
        t2, t2_prov = max(candidates, key=lambda row: row[0])

    t1_label = "Structural support (weekly)" if geo.target_1_source == "structural" else "Weekly ATR floor"
    return stop, t1, t2, used_atr, t2_prov, stop_label, t1_label


def build_position_composite_geometry_fields(
    *,
    symbol: str,
    composite: CompositeSignal,
    daily_bars: list[Bar],
    snapshot: Snapshot | None,
    tech: PositionTechnicalLayerResult,
    analyst_target_levels: list[float] | None,
    analyst_target_source: str,
    market_environment: dict[str, Any] | None,
) -> dict[str, Any]:
    """Flat geometry keys merged into POST /v1/signals/composite/position."""
    sym = str(symbol or "").strip().upper()
    last = _snap_price(snapshot)
    weekly = aggregate_daily_to_weekly_bars(daily_bars, sym)
    weekly_atr = compute_weekly_atr(weekly)
    weekly_dict = _bars_to_ohlc_dicts(weekly)
    range_lo, range_hi = _weekly_range(weekly)

    dir_conf = assess_direction_confidence(
        score=float(composite.score),
        confidence=float(composite.confidence),
        alignment_ratio=float(composite.alignment_ratio),
        is_neutral=composite.verdict == CompositeVerdict.NEUTRAL,
    )

    out: dict[str, Any] = {
        "symbol": sym,
        "mode": "position",
        "signal_summary": composite.verdict.value,
        "verdict": composite.verdict.value,
        "direction_confidence": dir_conf.tier,
        "direction_confidence_score": dir_conf.score,
        "direction_confidence_reason": dir_conf.reason,
        "atr_weekly": round(weekly_atr, 4) if weekly_atr is not None else None,
        "atr": round(weekly_atr, 4) if weekly_atr is not None else None,
        "analyst_target_levels": analyst_target_levels or None,
        "analyst_target_source": analyst_target_source or "none",
        "market_environment": market_environment,
    }

    if last is None or last <= 0 or weekly_atr is None or weekly_atr <= 0 or not weekly_dict:
        out["status"] = "incomplete"
        out["is_complete"] = False
        out["missing_fields"] = ["weekly_atr_or_price"]
        out["geometry_tradeable"] = False
        out["geometry_block_reason"] = "geometry_insufficient"
        out["desk_surface_eligible"] = False
        out["risk_reward"] = 0.0
        return out

    entry_zone = _position_entry_zone(
        last=last,
        weekly_sma50=tech.weekly_sma50,
        range_lo=range_lo,
        range_hi=range_hi,
    )
    entry = _entry_for_geometry(last, entry_zone)
    use_long = _use_long_geometry(composite.verdict, range_lo, range_hi, last)

    if use_long:
        stop, t1, t2, used_atr, t2_prov, stop_label, t1_label = _long_geometry(
            last=last,
            entry=entry,
            weekly_atr=weekly_atr,
            weekly_bars_dict=weekly_dict,
            range_lo=range_lo,
            range_hi=range_hi,
            weekly_sma50=tech.weekly_sma50,
            weekly_sma200=tech.weekly_sma200,
            analyst_levels=analyst_target_levels,
            analyst_target_source=analyst_target_source,
        )
    else:
        stop, t1, t2, used_atr, t2_prov, stop_label, t1_label = _short_geometry(
            last=last,
            entry=entry,
            weekly_atr=weekly_atr,
            weekly_bars_dict=weekly_dict,
            range_lo=range_lo,
            range_hi=range_hi,
            weekly_sma50=tech.weekly_sma50,
            weekly_sma200=tech.weekly_sma200,
            analyst_levels=analyst_target_levels,
            analyst_target_source=analyst_target_source,
        )

    k = position_reference_stop_atr_k()
    stop_prov = format_merged_stop_provenance(
        stop_label,
        atr_k=k,
        used_atr_floor=used_atr,
        atr_label="weekly ATR",
    )

    rr_t1: float | None = None
    rr_struct: float | None = None
    if stop is not None and t1 is not None:
        if use_long:
            rr_t1 = rr_from_levels_long(entry, t1, stop)
        else:
            rr_t1 = rr_from_levels_short(entry, t1, stop)
        rr_struct = structure_risk_reward_for_mode(
            entry,
            t1,
            stop,
            t2,
            t2_prov,
            trading_mode=_TRADING_MODE,
            use_long=use_long,
        )

    min_rr = min_risk_reward_from_environment(market_environment, mode="position")  # type: ignore[arg-type]
    risk_reward = round_risk_reward_display(rr_struct) if rr_struct is not None else 0.0

    out.update(
        {
            "last_trade_price": round(last, 4),
            "historical_entry_zone": entry_zone,
            "session_entry_zone": dict(entry_zone),
            "entry_zone_quality": "clean",
            "entry_anchor": tech.weekly_sma50,
            "reference_stop_level": stop,
            "reference_stop_provenance": stop_prov,
            "reference_target_1": t1,
            "reference_target_2": t2,
            "reference_target_2_provenance": t2_prov,
            "reference_target_provenance": t1_label,
            "reference_stop_distance_atr": distance_in_atr(stop, entry, weekly_atr),
            "reference_target_1_distance_atr": distance_in_atr(t1, entry, weekly_atr),
            "reference_target_2_distance_atr": distance_in_atr(t2, entry, weekly_atr),
            "structure_risk_reward": round_risk_reward_display(rr_struct) if rr_struct is not None else None,
            "t1_risk_reward": round_risk_reward_display(rr_t1) if rr_t1 is not None else None,
            "risk_reward": risk_reward,
            "min_rr_desk": min_rr,
            "rr_warning": rr_struct is None or float(risk_reward) < min_rr,
            "rr_quality": (
                "low"
                if rr_struct is None or float(risk_reward) < min_rr
                else "moderate"
                if float(risk_reward) < 2.5
                else "strong"
            ),
            "reference_target_2_suppressed": False,
        }
    )

    is_complete, missing = _position_signal_complete(out, rr_struct=rr_struct, min_rr=min_rr)
    out["is_complete"] = is_complete
    out["missing_fields"] = missing
    out["status"] = "active" if is_complete else "incomplete"

    eligible, block_reason = geometry_tradeability(out, mode="position", symbol=sym)  # type: ignore[arg-type]
    out["geometry_tradeable"] = eligible
    out["geometry_block_reason"] = block_reason
    out["desk_surface_eligible"] = eligible
    return out
