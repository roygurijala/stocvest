"""Deterministic swing-composite API fields for signal evidence UI (not investment advice)."""

from __future__ import annotations

import math
from typing import Any

from stocvest.api.services.risk_reward_structure import (
    round_risk_reward_display,
    structure_risk_reward_long,
    structure_risk_reward_short,
)
from stocvest.api.services.market_environment import (
    min_risk_reward_from_environment,
    suppress_reference_target_2,
    target_policy_from_environment,
)
from stocvest.api.services.entry_zone import (
    config_for_mode as entry_zone_config_for_mode,
    resolve_anchor as entry_zone_resolve_anchor,
    resolve_entry_zone,
)
from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict
from stocvest.api.services.reference_stop_policy import (
    format_merged_stop_provenance,
    reference_stop_atr_k,
    resolve_merged_reference_stop,
    resolve_structural_stop_anchor,
)
from stocvest.signals.vwap_state import VWAP_STATE_TOOLTIP, VWAPState, build_vwap_chip, resolve_vwap_state


def _float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _merge_catalyst_row(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Merge two catalyst dicts; prefer non-empty fields and stronger sentiment from b."""
    out = dict(a)
    for key in ("text", "sentiment", "source", "published_at", "sentiment_score"):
        if key not in b:
            continue
        bv = b[key]
        if bv is None or (isinstance(bv, str) and not str(bv).strip()):
            continue
        av = out.get(key)
        if key == "sentiment":
            ac = str(av or "neutral").lower()
            bc = str(bv).lower()
            if ac == "neutral" and bc in ("positive", "negative"):
                out[key] = _sentiment_bucket(str(bv))
            elif av in (None, ""):
                out[key] = _sentiment_bucket(str(bv))
        elif key == "sentiment_score":
            if _float_or_none(bv) is not None and _float_or_none(av) is None:
                out[key] = float(bv)
        elif av in (None, ""):
            out[key] = bv
    return out


def _dedupe_catalyst_rows_ordered(rows: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for r in rows:
        t = str(r.get("text") or "").strip()
        if not t:
            continue
        k = t.lower()[:160]
        if k not in by_key:
            by_key[k] = dict(r)
            order.append(k)
        else:
            by_key[k] = _merge_catalyst_row(by_key[k], r)
    return [by_key[k] for k in order[:limit]]


def _snap_float(snap: dict[str, Any], key: str) -> float | None:
    raw = snap.get(key)
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _sentiment_bucket(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in ("positive", "negative", "neutral"):
        return s
    if "bull" in s or "up" in s or "constructive" in s:
        return "positive"
    if "bear" in s or "down" in s or "risk" in s:
        return "negative"
    return "neutral"


def _intraday_vwap_from_payload_bars(payload: dict[str, Any]) -> float | None:
    bars = payload.get("intraday_bars")
    if not isinstance(bars, list) or not bars:
        return None
    numer = 0.0
    denom = 0.0
    for bar in bars:
        if not isinstance(bar, dict):
            continue
        hi = _snap_float(bar, "high")
        lo = _snap_float(bar, "low")
        close = _snap_float(bar, "close")
        vol = _snap_float(bar, "volume")
        if hi is None or lo is None or close is None or vol is None or vol <= 0:
            continue
        typical = (hi + lo + close) / 3.0
        numer += typical * vol
        denom += vol
    if denom <= 0:
        return None
    return numer / denom


def is_signal_complete(signal: dict[str, Any]) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not signal.get("historical_entry_zone"):
        missing.append("entry_zone")
    if signal.get("reference_stop_level") is None:
        missing.append("stop_level")
    if signal.get("reference_target_1") is None:
        missing.append("target_1")
    vdisp = str(signal.get("vwap_display") or "").strip()
    vnum = signal.get("vwap")
    if not vdisp and not (isinstance(vnum, (int, float)) and vnum is not None and float(vnum) > 0):
        missing.append("vwap")
    return (len(missing) == 0, missing)


def _synthetic_rr_from_composite(composite: CompositeSignal) -> float:
    """Legacy heuristic when price structure cannot support (target-entry)/(entry-stop)."""
    conf = float(composite.confidence)
    mag = abs(float(composite.score))
    return round(min(3.5, max(1.0, 1.15 + conf * 1.55 + mag * 1.05)), 1)


def _entry_price_for_rr(
    last: float | None,
    zone_lo: float | None,
    zone_hi: float | None,
) -> float | None:
    if last is not None and last > 0:
        return float(last)
    if zone_lo is not None and zone_hi is not None and zone_hi > zone_lo:
        return float((zone_lo + zone_hi) / 2.0)
    return None


def _swing_range_from_payload(payload: dict[str, Any], *, lookback: int = 10) -> dict[str, float | int] | None:
    """High/low over the last ``lookback`` daily bars when the engine passes OHLC rows."""
    raw = payload.get("daily_bars_range")
    if not isinstance(raw, list) or len(raw) < 3:
        return None
    lows: list[float] = []
    highs: list[float] = []
    for row in raw[-lookback:]:
        if not isinstance(row, dict):
            continue
        lo = _float_or_none(row.get("low"))
        hi = _float_or_none(row.get("high"))
        if lo is not None and lo > 0:
            lows.append(lo)
        if hi is not None and hi > 0:
            highs.append(hi)
    if len(lows) < 3 or len(highs) < 3:
        return None
    swing_lo = min(lows)
    swing_hi = max(highs)
    if swing_hi <= swing_lo:
        return None
    return {
        "low": round(swing_lo, 4),
        "high": round(swing_hi, 4),
        "sessions": min(lookback, len(lows)),
    }


def _long_stop_provenance_label(
    *,
    day_lo: float | None,
    day_hi: float | None,
    vwap: float | None,
    prev_close: float | None,
    last: float | None,
) -> str:
    if day_lo is not None and day_lo > 0 and vwap is not None and vwap > 0:
        return "Below min(session low, VWAP) — structural buffer"
    if day_lo is not None and day_lo > 0:
        return "Below session low — structural buffer"
    if vwap is not None and vwap > 0:
        return "Below VWAP — structural buffer"
    if prev_close is not None and prev_close > 0:
        return "Below prior close (99% rule) — fallback"
    if last is not None and last > 0:
        return "Below last price (98% rule) — fallback"
    return "Structural stop — source unavailable"


def _long_target_provenance_label(
    *,
    day_hi: float | None,
    last: float | None,
    reference_target_2: float | None,
) -> str:
    if day_hi is not None and day_hi > 0:
        if reference_target_2 is not None:
            return "Session high (T1) + 2R extension (T2)"
        return "Session high — primary target"
    if last is not None and last > 0:
        return "Percent extension from last — fallback"
    return "Target — source unavailable"


def _short_stop_provenance_label(
    *,
    day_lo: float | None,
    day_hi: float | None,
    vwap: float | None,
    prev_close: float | None,
    last: float | None,
) -> str:
    if day_hi is not None and day_hi > 0 and vwap is not None and vwap > 0:
        return "Above max(session high, VWAP) — structural buffer"
    if day_hi is not None and day_hi > 0:
        return "Above session high — structural buffer"
    if vwap is not None and vwap > 0:
        return "Above VWAP — structural buffer"
    if prev_close is not None and prev_close > 0:
        return "Above prior close (101% rule) — fallback"
    if last is not None and last > 0:
        return "Above last price (102% rule) — fallback"
    return "Structural stop — source unavailable"


def _short_target_provenance_label(
    *,
    day_lo: float | None,
    last: float | None,
    reference_target_2: float | None,
) -> str:
    if day_lo is not None and day_lo > 0:
        if reference_target_2 is not None:
            return "Session low (T1) + 2R extension (T2)"
        return "Session low — primary target"
    if last is not None and last > 0:
        return "Percent extension from last — fallback"
    return "Target — source unavailable"


def serialize_daily_bars_for_range(bars: list[Any], *, limit: int = 10) -> list[dict[str, float]]:
    """Compact daily OHLC rows for swing range (newest ``limit`` sessions)."""
    if not bars:
        return []
    try:
        ordered = sorted(bars, key=lambda b: b.timestamp)[-limit:]
    except AttributeError:
        return []
    out: list[dict[str, float]] = []
    for b in ordered:
        try:
            lo = float(b.low)
            hi = float(b.high)
        except (TypeError, ValueError, AttributeError):
            continue
        if lo > 0 and hi > 0 and hi >= lo:
            out.append({"low": lo, "high": hi})
    return out


def _payload_atr(payload: dict[str, Any]) -> float | None:
    raw = payload.get("atr")
    if isinstance(raw, (int, float)) and float(raw) > 0:
        return float(raw)
    return None


def _trading_mode_from_payload(payload: dict[str, Any]) -> str:
    mode = str(payload.get("trading_mode") or payload.get("mode") or "swing").strip().lower()
    return "day" if mode == "day" else "swing"


def _effective_rr_target(
    *,
    entry: float,
    stop: float,
    target_1: float,
    target_2: float | None,
    is_long: bool,
) -> float:
    """The target the trade plans to — mirrors ``structure_risk_reward_*``: prefer
    T1, but use T2 when T1's R/R is sub-1:1 and T2 improves it."""
    def _rr(t: float) -> float | None:
        risk = (entry - stop) if is_long else (stop - entry)
        reward = (t - entry) if is_long else (entry - t)
        if risk <= 1e-6 or reward <= 1e-6:
            return None
        return reward / risk

    if target_2 is None:
        return target_1
    rr1 = _rr(target_1)
    rr2 = _rr(target_2)
    if rr1 is None:
        return target_2 if rr2 is not None else target_1
    if rr2 is None:
        return target_1
    if rr1 < 1.0 and rr2 > rr1:
        return target_2
    return target_1


def _long_side_geometry(
    *,
    day_lo: float | None,
    day_hi: float | None,
    vwap: float | None,
    prev_close: float | None,
    last: float | None,
    entry: float | None = None,
    atr: float | None = None,
    trading_mode: str = "swing",
    swing_lo: float | None = None,
    swing_hi: float | None = None,
    zone_lo: float | None = None,
    zone_hi: float | None = None,
) -> tuple[float | None, float | None, float | None, bool]:
    """
    Bullish reference levels anchored to session structure (not fixed % off day low).

    Stop: structural anchor merged with entry − k×ATR floor when ATR is available.
    Targets: session high as primary resistance; second target = 2R extension from entry when possible.
    """
    structural = resolve_structural_stop_anchor(
        direction="bullish",
        session_low=day_lo,
        session_high=day_hi,
        vwap=vwap,
        prev_close=prev_close,
        last=last,
        swing_low=swing_lo,
        swing_high=swing_hi,
        zone_lo=zone_lo,
        zone_hi=zone_hi,
    )
    entry_for_stop = entry if entry is not None and entry > 0 else (last if last is not None and last > 0 else None)
    reference_stop = structural
    used_atr_floor = False
    if entry_for_stop is not None and structural is not None:
        k = reference_stop_atr_k(trading_mode=trading_mode)  # type: ignore[arg-type]
        reference_stop, used_atr_floor = resolve_merged_reference_stop(
            direction="bullish",
            entry=float(entry_for_stop),
            structural_stop=structural,
            atr=atr,
            atr_k=k,
        )

    reference_target_1: float | None = None
    if day_hi is not None and day_hi > 0:
        reference_target_1 = round(float(day_hi), 4)
    elif last is not None and last > 0:
        reference_target_1 = round(float(last) * 1.012, 4)

    reference_target_2: float | None = None
    if reference_target_1 is not None and reference_stop is not None:
        entry_guess = last if (last is not None and last > 0) else None
        if entry_guess is not None and entry_guess > reference_stop:
            t2_r = entry_guess + 2.0 * (entry_guess - reference_stop)
            if t2_r > reference_target_1 + 1e-6:
                reference_target_2 = round(t2_r, 4)
    if reference_target_2 is None and reference_target_1 is not None and last is not None and last > 0:
        reference_target_2 = round(float(reference_target_1) * 1.004, 4)

    return reference_stop, reference_target_1, reference_target_2, used_atr_floor


def _short_side_geometry(
    *,
    day_lo: float | None,
    day_hi: float | None,
    vwap: float | None,
    prev_close: float | None,
    last: float | None,
    entry: float | None = None,
    atr: float | None = None,
    trading_mode: str = "swing",
    swing_lo: float | None = None,
    swing_hi: float | None = None,
) -> tuple[float | None, float | None, float | None, bool]:
    """Bearish reference levels: stop above session/VWAP ceiling; target at session low."""
    structural = resolve_structural_stop_anchor(
        direction="bearish",
        session_low=day_lo,
        session_high=day_hi,
        vwap=vwap,
        prev_close=prev_close,
        last=last,
        swing_low=swing_lo,
        swing_high=swing_hi,
    )
    entry_for_stop = entry if entry is not None and entry > 0 else (last if last is not None and last > 0 else None)
    reference_stop = structural
    used_atr_floor = False
    if entry_for_stop is not None and structural is not None:
        k = reference_stop_atr_k(trading_mode=trading_mode)  # type: ignore[arg-type]
        reference_stop, used_atr_floor = resolve_merged_reference_stop(
            direction="bearish",
            entry=float(entry_for_stop),
            structural_stop=structural,
            atr=atr,
            atr_k=k,
        )

    reference_target_1: float | None = None
    if day_lo is not None and day_lo > 0:
        reference_target_1 = round(float(day_lo), 4)
    elif last is not None and last > 0:
        reference_target_1 = round(float(last) * 0.988, 4)

    reference_target_2: float | None = None
    if reference_target_1 is not None and reference_stop is not None:
        entry_guess = last if (last is not None and last > 0) else None
        if entry_guess is not None and reference_stop > entry_guess:
            t2_r = entry_guess - 2.0 * (reference_stop - entry_guess)
            if t2_r < reference_target_1 - 1e-6:
                reference_target_2 = round(t2_r, 4)
    if reference_target_2 is None and reference_target_1 is not None and last is not None and last > 0:
        reference_target_2 = round(float(reference_target_1) * 0.996, 4)

    return reference_stop, reference_target_1, reference_target_2, used_atr_floor


def _use_long_rr_structure(verdict: CompositeVerdict, day_lo: float | None, day_hi: float | None, last: float | None) -> bool:
    if verdict == CompositeVerdict.BULLISH:
        return True
    if verdict == CompositeVerdict.BEARISH:
        return False
    if (
        day_lo is not None
        and day_hi is not None
        and day_hi > day_lo
        and last is not None
        and last > 0
    ):
        mid = (float(day_lo) + float(day_hi)) / 2.0
        return float(last) >= mid
    return True


def build_swing_composite_evidence_fields(
    *,
    composite: CompositeSignal,
    regime: str,
    payload: dict[str, Any],
    confluence: dict[str, Any] | None,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Returns flat dict keys merged into POST /v1/signals/swing/composite JSON body."""
    score = float(composite.score)
    conf = float(composite.confidence)
    mag = abs(score)

    if mag >= 0.35:
        trend_strength = "Strong"
    elif mag >= 0.15:
        trend_strength = "Moderate"
    else:
        trend_strength = "Weak"

    n_conf = int(confluence.get("n_conflicting") or 0) if confluence else 0
    n_conf_yes = int(confluence.get("n_confirming") or 0) if confluence else 0

    if composite.verdict == CompositeVerdict.NEUTRAL:
        trend_direction = "Reversing" if n_conf >= 2 and n_conf_yes >= 1 else "Sideways"
    elif composite.verdict == CompositeVerdict.BULLISH:
        trend_direction = "Uptrend"
    else:
        trend_direction = "Downtrend"

    reg = (regime or "sideways").strip().lower()
    if reg in ("bull", "bullish"):
        market_regime = "Bullish"
    elif reg in ("bear", "bearish"):
        market_regime = "Bearish"
    else:
        market_regime = "Neutral"

    last = _snap_float(snapshot, "last_trade_price")
    day_lo = _snap_float(snapshot, "day_low")
    day_hi = _snap_float(snapshot, "day_high")
    prev_close = _snap_float(snapshot, "prev_close")
    vwap = _snap_float(snapshot, "day_vwap")
    if vwap is None and bool(payload.get("market_open")):
        vwap = _intraday_vwap_from_payload_bars(payload)

    intraday_list = payload.get("intraday_bars")
    n_bars_raw = payload.get("intraday_bar_count")
    if isinstance(n_bars_raw, int) and n_bars_raw >= 0:
        n_bars = int(n_bars_raw)
    else:
        n_bars = len(intraday_list) if isinstance(intraday_list, list) else 0
    # Session flags: omitting ``market_open`` / RTH keys means "no intraday context in payload"
    # (swing BFF + unit tests). Default market_open True so snapshot ``day_vwap`` is not
    # classified as post-market and stripped from the response.
    if "vwap_session_market_open" in payload:
        mo = bool(payload.get("vwap_session_market_open"))
    elif "market_open" in payload:
        mo = bool(payload.get("market_open"))
    else:
        mo = True
    ipm = bool(payload.get("vwap_session_is_pre_market", False))
    ts_override = str(payload.get("vwap_state") or "").strip()
    if ts_override:
        try:
            vs = VWAPState(ts_override)
        except ValueError:
            adj_bars = n_bars
            if adj_bars == 0 and vwap is not None and vwap > 0 and mo:
                adj_bars = 20
            vs = resolve_vwap_state(vwap, mo, adj_bars, ipm)
    else:
        adj_bars = n_bars
        if adj_bars == 0 and vwap is not None and vwap > 0 and mo:
            adj_bars = 20
        vs = resolve_vwap_state(vwap, mo, adj_bars, ipm)

    vwap_display = str(payload.get("vwap_display") or "").strip()
    if not vwap_display:
        vwap_display = build_vwap_chip(vs, vwap, last)
    vwap_tooltip = str(payload.get("vwap_state_tooltip") or "").strip()
    if not vwap_tooltip:
        vwap_tooltip = VWAP_STATE_TOOLTIP[vs]

    historical_entry_zone: dict[str, float] | None = None
    if day_lo is not None and day_hi is not None and day_hi > day_lo:
        historical_entry_zone = {"low": round(day_lo, 4), "high": round(day_hi, 4)}
    elif last is not None and last > 0:
        historical_entry_zone = {
            "low": round(last * 0.985, 4),
            "high": round(last * 1.015, 4),
        }

    zone_lo = historical_entry_zone["low"] if historical_entry_zone else None
    zone_hi = historical_entry_zone["high"] if historical_entry_zone else None
    entry = _entry_price_for_rr(last, zone_lo, zone_hi)
    swing_range_zone = _swing_range_from_payload(payload)
    swing_lo = float(swing_range_zone["low"]) if swing_range_zone else None
    swing_hi = float(swing_range_zone["high"]) if swing_range_zone else None
    atr = _payload_atr(payload)
    trading_mode = _trading_mode_from_payload(payload)

    use_long = _use_long_rr_structure(composite.verdict, day_lo, day_hi, last)
    if use_long:
        reference_stop_level, reference_target_1, reference_target_2, used_atr_floor = _long_side_geometry(
            day_lo=day_lo,
            day_hi=day_hi,
            vwap=vwap,
            prev_close=prev_close,
            last=last,
            entry=entry,
            atr=atr,
            trading_mode=trading_mode,
            swing_lo=swing_lo,
            swing_hi=swing_hi,
            zone_lo=zone_lo,
            zone_hi=zone_hi,
        )
        reference_stop_provenance = format_merged_stop_provenance(
            _long_stop_provenance_label(
                day_lo=day_lo,
                day_hi=day_hi,
                vwap=vwap,
                prev_close=prev_close,
                last=last,
            ),
            atr_k=reference_stop_atr_k(trading_mode=trading_mode),  # type: ignore[arg-type]
            used_atr_floor=used_atr_floor,
        )
        reference_target_provenance = _long_target_provenance_label(
            day_hi=day_hi,
            last=last,
            reference_target_2=reference_target_2,
        )
    else:
        reference_stop_level, reference_target_1, reference_target_2, used_atr_floor = _short_side_geometry(
            day_lo=day_lo,
            day_hi=day_hi,
            vwap=vwap,
            prev_close=prev_close,
            last=last,
            entry=entry,
            atr=atr,
            trading_mode=trading_mode,
            swing_lo=swing_lo,
            swing_hi=swing_hi,
        )
        reference_stop_provenance = format_merged_stop_provenance(
            _short_stop_provenance_label(
                day_lo=day_lo,
                day_hi=day_hi,
                vwap=vwap,
                prev_close=prev_close,
                last=last,
            ),
            atr_k=reference_stop_atr_k(trading_mode=trading_mode),  # type: ignore[arg-type]
            used_atr_floor=used_atr_floor,
        )
        reference_target_provenance = _short_target_provenance_label(
            day_lo=day_lo,
            last=last,
            reference_target_2=reference_target_2,
        )

    env_raw = payload.get("market_environment")
    env_dict = env_raw if isinstance(env_raw, dict) else None
    target_policy = target_policy_from_environment(env_dict)
    reference_target_2_suppressed = False
    if suppress_reference_target_2(target_policy) and reference_target_2 is not None:
        reference_target_2 = None
        reference_target_2_suppressed = True
        suffix = " · T2 suppressed — elevated VIX environment (plan to T1)"
        reference_target_provenance = (
            f"{reference_target_provenance}{suffix}"
            if reference_target_provenance
            else "T2 suppressed — elevated VIX environment (plan to T1)"
        )
    elif target_policy == "t1_preferred" and reference_target_2 is not None:
        suffix = " · T2 optional — elevated VIX; prefer T1 for R/R"
        reference_target_provenance = (
            f"{reference_target_provenance}{suffix}"
            if reference_target_provenance
            else "T2 optional — elevated VIX; prefer T1 for R/R"
        )

    rr_from_structure: float | None = None
    if (
        entry is not None
        and reference_stop_level is not None
        and reference_target_1 is not None
    ):
        if use_long:
            rr_from_structure = structure_risk_reward_long(
                entry,
                reference_target_1,
                reference_stop_level,
                reference_target_2,
            )
        else:
            rr_from_structure = structure_risk_reward_short(
                entry,
                reference_target_1,
                reference_stop_level,
                reference_target_2,
            )

    if rr_from_structure is not None:
        risk_reward = round_risk_reward_display(rr_from_structure)
    else:
        risk_reward = _synthetic_rr_from_composite(composite)

    mode = str(payload.get("mode") or "swing").strip().lower()
    mode_for_env: str = "day" if mode == "day" else "swing"
    min_rr = min_risk_reward_from_environment(env_dict, mode=mode_for_env)  # type: ignore[arg-type]
    rr_warning = risk_reward < min_rr
    if risk_reward < min_rr:
        rr_quality = "low"
    elif risk_reward < 3.0:
        rr_quality = "acceptable"
    elif risk_reward < 5.0:
        rr_quality = "good"
    else:
        rr_quality = "strong"

    # --- Entry-zone synthesis (post-processing on the finalized reference levels) ---
    # Replace the raw session/swing range with a tight, anchored, validated band so
    # the served "entry zone" is actionable and never overlaps T1. The headline R/R
    # above is unchanged (it uses the current price as entry); the zone only carries
    # a *secondary* worst-case R/R. The worst-case floor is held at or below the
    # headline ``min_rr`` so an elevated-VIX day never produces contradictory gates.
    ez_cfg = dict(entry_zone_config_for_mode(payload.get("entry_zone_config"), trading_mode))
    ez_cfg["min_rr_from_zone_high"] = min(float(ez_cfg["min_rr_from_zone_high"]), max(1.0, float(min_rr)))
    entry_zone_quality: str | None = None
    entry_zone_worst_case_rr: float | None = None
    if last is not None and last > 0 and reference_stop_level is not None and reference_target_1 is not None:
        ez_anchor = entry_zone_resolve_anchor(
            preferred=str(ez_cfg["preferred_anchor"]),
            vwap=vwap,
            prev_close=prev_close,
            sma20=_float_or_none(payload.get("sma20")),
            sma50=_float_or_none(payload.get("sma50")),
            last=last,
        )
        # Validate against the target the engine actually trades to (the same T1/T2
        # selection the headline R/R uses), not T1 unconditionally — otherwise a
        # signal whose T1 sits just above entry (and plans to T2) gets a false
        # "no clean entry" flag.
        ez_effective_target = _effective_rr_target(
            entry=last,
            stop=reference_stop_level,
            target_1=reference_target_1,
            target_2=reference_target_2,
            is_long=use_long,
        )
        ez = resolve_entry_zone(
            direction="long" if use_long else "short",
            last=last,
            stop=reference_stop_level,
            target_1=ez_effective_target,
            anchor=ez_anchor,
            atr=atr,
            config=ez_cfg,
        )
        if ez is not None:
            # Keep the band for display even when flagged "no_clean_entry"; the flag
            # + risk factor let callers downgrade tradeability rather than hide it.
            historical_entry_zone = {"low": ez.low, "high": ez.high}
            entry_zone_quality = ez.quality
            entry_zone_worst_case_rr = ez.worst_case_rr

    signal_score = int(round(max(0.0, min(100.0, (score + 1.0) / 2.0 * 100.0))))
    if rr_warning:
        signal_score = int(round(max(0.0, min(100.0, signal_score * 0.8))))

    catalyst_rows: list[dict[str, Any]] = []
    extras = payload.get("catalyst_headlines")
    if isinstance(extras, list):
        for item in extras[:6]:
            if isinstance(item, dict) and item.get("text"):
                row: dict[str, Any] = {
                    "text": str(item["text"]).strip()[:240],
                    "sentiment": _sentiment_bucket(str(item.get("sentiment") or "neutral")),
                }
                src = str(item.get("source") or "").strip()
                if src:
                    row["source"] = src
                pub = str(item.get("published_at") or item.get("published_utc") or "").strip()
                if pub:
                    row["published_at"] = pub
                ss = _float_or_none(item.get("sentiment_score"))
                if ss is not None:
                    row["sentiment_score"] = ss
                catalyst_rows.append(row)
            elif isinstance(item, str) and item.strip():
                catalyst_rows.append({"text": item.strip()[:240], "sentiment": "neutral"})
    nc = payload.get("news_catalyst")
    if isinstance(nc, dict):
        headline = nc.get("headline") or nc.get("title") or nc.get("text")
        if headline:
            row_nc: dict[str, Any] = {
                "text": str(headline).strip()[:240],
                "sentiment": _sentiment_bucket(str(nc.get("sentiment") or "neutral")),
            }
            src_nc = str(nc.get("source") or "").strip()
            if src_nc:
                row_nc["source"] = src_nc
            pub_nc = str(nc.get("published_at") or nc.get("published_utc") or "").strip()
            if pub_nc:
                row_nc["published_at"] = pub_nc
            ss_nc = _float_or_none(nc.get("sentiment_score"))
            if ss_nc is not None:
                row_nc["sentiment_score"] = ss_nc
            catalyst_rows.append(row_nc)
    catalysts = _dedupe_catalyst_rows_ordered(catalyst_rows, 3)

    risk_factors_detailed: list[dict[str, str]] = []
    geo_verdict = str(payload.get("geopolitical_verdict") or "").strip().lower()
    geo_high = int(payload.get("geo_high_impact_count") or 0)
    if geo_verdict == "bearish" or geo_high > 2:
        if geo_high > 0:
            geo_detail = (
                f"{geo_high} top-tier (H) headline match"
                f"{'es' if geo_high != 1 else ''} in the geopolitical scan window."
            )
        else:
            geo_detail = "Geopolitical layer is bearish with no top-tier (H) headline matches in the scan window."
        risk_factors_detailed.append(
            {
                "label": "Elevated Geopolitical Risk",
                "severity": "high",
                "detail": geo_detail,
            }
        )
    if bool(payload.get("ema_conflict")):
        risk_factors_detailed.append(
            {
                "label": "EMA Stack Conflict",
                "severity": "medium",
                "detail": "EMA stack does not confirm trend direction",
            }
        )
    if env_dict:
        tier = str(env_dict.get("environment_tier") or "normal")
        headline = str(env_dict.get("headline") or "").strip()
        if tier in ("stressed", "crisis"):
            risk_factors_detailed.append(
                {
                    "label": "Market Environment",
                    "severity": "high",
                    "detail": headline or f"Environment tier {tier} — review before new entries.",
                }
            )
        elif tier == "elevated":
            risk_factors_detailed.append(
                {
                    "label": "Market Environment",
                    "severity": "medium",
                    "detail": headline or "Elevated VIX — stricter R/R and T1-first targets.",
                }
            )
    if rr_warning:
        risk_factors_detailed.append(
            {
                "label": "Low Risk/Reward",
                "severity": "high",
                "detail": f"R/R {risk_reward:.1f}:1 is below minimum {min_rr:.1f}:1 threshold",
            }
        )
    if entry_zone_quality == "no_clean_entry":
        risk_factors_detailed.append(
            {
                "label": "No Clean Entry Zone",
                "severity": "medium",
                "detail": (
                    "Stop and first target are too close to carve an entry band that keeps "
                    f"R/R ≥ {ez_cfg['min_rr_from_zone_high']:.1f}:1 from the far edge — wait for a better structure."
                ),
            }
        )
    alignment_ratio = float(composite.alignment_ratio)
    total_layers = int(round(float(composite.aligned_weight + composite.conflicted_weight)))
    conflicted_count = int(round(float(composite.conflicted_weight)))
    if alignment_ratio < 0.5 and total_layers > 0:
        risk_factors_detailed.append(
            {
                "label": "Conflicted Signal",
                "severity": "high",
                "detail": f"{conflicted_count} of {total_layers} layers conflict with signal direction",
            }
        )
    news_verdict = str(payload.get("news_verdict") or "").strip().lower()
    signal_verdict = str(composite.verdict.value).strip().lower()
    news_score = float(payload.get("news_sentiment_score") or 0.0)
    if news_verdict and news_verdict != signal_verdict and abs(news_score) > 0.5:
        risk_factors_detailed.append(
            {
                "label": "News Sentiment Conflict",
                "severity": "medium",
                "detail": "News sentiment direction opposes signal verdict",
            }
        )
    stale_layers = payload.get("stale_layers")
    if isinstance(stale_layers, list):
        for row in stale_layers[:1]:
            if isinstance(row, dict):
                n = str(row.get("name") or "Unknown layer")
                mins = int(row.get("minutes_ago") or 0)
                risk_factors_detailed.append(
                    {
                        "label": "Stale Layer Data",
                        "severity": "low",
                        "detail": f"{n} data is {mins}m old",
                    }
                )
    perplexity_headwinds = payload.get("perplexity_headwinds")
    if isinstance(perplexity_headwinds, list):
        for hw in perplexity_headwinds[:4]:
            text = str(hw or "").strip()
            if text:
                risk_factors_detailed.append(
                    {
                        "label": "Fundamental Headwind",
                        "severity": "medium",
                        "detail": text[:240],
                    }
                )

    risk_factors = [f"{r['label']}: {r['detail']}" for r in risk_factors_detailed]
    if not risk_factors:
        risk_factors = ["No significant risk factors detected"]

    sym = str(payload.get("symbol") or "").strip().upper() or "SYMBOL"
    zone_txt = (
        f"${historical_entry_zone['low']:.2f}–${historical_entry_zone['high']:.2f}"
        if historical_entry_zone
        else "the Historical Entry Zone shown in reference levels"
    )
    vw_txt = vwap_display if vwap_display else "VWAP from the reference strip"
    signal_parameters = (
        f"Consider observing how {sym} behaves versus {zone_txt} on a closing basis before sizing any follow-up. "
        f"Scale participation down when confirming layers diverge or when price cannot hold {vw_txt}. "
        "Invalidate the constructive read on a decisive close back through the lower bound of the Historical Entry Zone "
        "for this horizon. Signal data only — not investment advice."
    )

    out: dict[str, Any] = {
        "signal_score": signal_score,
        "trend_strength": trend_strength,
        "trend_direction": trend_direction,
        "risk_reward": risk_reward,
        "rr_warning": rr_warning,
        "rr_quality": rr_quality,
        "market_regime": market_regime,
        "catalysts": catalysts,
        "catalyst_headlines": catalysts,
        "risk_factors": risk_factors,
        "risk_factors_detailed": risk_factors_detailed,
        "signal_parameters": signal_parameters,
        "historical_entry_zone": historical_entry_zone,
        "session_entry_zone": historical_entry_zone,
        "entry_zone_quality": entry_zone_quality,
        "entry_zone_worst_case_rr": entry_zone_worst_case_rr,
        "swing_range_zone": swing_range_zone,
        "reference_target_1": reference_target_1,
        "reference_target_2": reference_target_2,
        "reference_stop_level": reference_stop_level,
        "reference_stop_provenance": reference_stop_provenance,
        "reference_target_provenance": reference_target_provenance,
        "reference_target_2_suppressed": reference_target_2_suppressed,
        "min_rr_desk": min_rr,
        "alignment_ratio": round(float(composite.alignment_ratio), 4),
        "conflicted_layers": list(composite.conflicted_layers or []),
        "vwap_state": vs.value,
        "vwap_display": vwap_display,
        "vwap_tooltip": vwap_tooltip,
    }
    if vwap is not None and vwap > 0 and vs == VWAPState.AVAILABLE:
        out["vwap"] = round(vwap, 4)
    is_complete, missing_fields = is_signal_complete(out)
    out["is_complete"] = is_complete
    out["missing_fields"] = missing_fields
    out["status"] = "active" if is_complete else "incomplete"
    if env_dict:
        out["market_environment"] = env_dict
    return out
