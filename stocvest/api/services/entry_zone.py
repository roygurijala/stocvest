"""Entry-zone synthesis & validation (post-processing on computed reference levels).

The entry zone is a *tight, actionable* band — the price region where it is still
reasonable to enter — **not** the full intraday/swing range. It is anchored to a
structural level (VWAP for day, SMA for swing) and capped to a configurable width.

Key invariants enforced by :func:`validate_entry_zone` (these catch the historical
bug where the zone spanned the whole session and its top edge equalled T1):

* the zone clears the stop (``low > stop`` for longs / ``high < stop`` for shorts);
* the zone sits short of the first target (never overlaps T1);
* the **worst-case** edge of the zone (the high for a long, the low for a short)
  still yields R/R ≥ ``min_rr_from_zone_high``.

When a constraint is violated the far edge is **clamped inward** (we never raise —
that would suppress otherwise-valid signals). If no valid band remains the result
is flagged ``no_clean_entry`` so the caller can degrade gracefully.

R/R for the headline gauge is computed elsewhere from the *current price*; this
module only shapes the served zone and reports a secondary worst-case R/R.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

_EPS = 1e-6

EntryStyle = Literal["pullback", "breakout"]
DistanceTier = Literal["ideal", "acceptable", "chasing"]
QualityTier = Literal["high", "medium", "low"]
ValidationQuality = Literal["clean", "clamped", "no_clean_entry"]

# --- Config (defaults mirror stocvest.config.signal_parameters.EntryZoneParameters) ---
DEFAULTS: dict[str, dict[str, float | str]] = {
    "day": {
        "max_width_pct": 0.005,
        "min_width_pct": 0.002,
        "preferred_anchor": "vwap",
        "atr_k": 0.5,
        "max_extension_gamma": 1.5,
        "breakout_band_atr_k": 0.4,
        "structure_band_atr_k": 0.4,
    },
    "swing": {
        "max_width_pct": 0.020,
        "min_width_pct": 0.005,
        "preferred_anchor": "sma20",
        "atr_k": 1.0,
        "max_extension_gamma": 2.5,
        "breakout_band_atr_k": 0.6,
        "structure_band_atr_k": 0.6,
    },
}
DEFAULT_MIN_RR_FROM_ZONE_HIGH: float = 1.5

_BREAKOUT_TOKENS = (
    "breakout",
    "orb",
    "momentum",
    "breakdown",
    "hod",
    "lod",
)
_PULLBACK_TOKENS = (
    "pullback",
    "dip",
    "reclaim",
    "mean_reversion",
    "bounce",
)


def config_for_mode(payload_cfg: dict | None, trading_mode: str) -> dict:
    """Resolve the per-mode entry-zone config, falling back to module defaults.

    ``payload_cfg`` is the optional ``entry_zone`` block threaded from
    SignalParameters (Secrets Manager). Unknown / missing keys fall back to the
    defaults above, so the engine works even when the secret omits the block.
    """
    mode = "day" if trading_mode == "day" else "swing"
    base = dict(DEFAULTS[mode])
    out: dict = dict(base)
    out["min_rr_from_zone_high"] = DEFAULT_MIN_RR_FROM_ZONE_HIGH
    if isinstance(payload_cfg, dict):
        block = payload_cfg.get(mode)
        if isinstance(block, dict):
            for k in (
                "max_width_pct",
                "min_width_pct",
                "atr_k",
                "max_extension_gamma",
                "breakout_band_atr_k",
                "structure_band_atr_k",
            ):
                v = block.get(k)
                if isinstance(v, (int, float)) and float(v) > 0:
                    out[k] = float(v)
            pa = block.get("preferred_anchor")
            if isinstance(pa, str) and pa.strip():
                out["preferred_anchor"] = pa.strip().lower()
        mrr = payload_cfg.get("min_rr_from_zone_high")
        if isinstance(mrr, (int, float)) and float(mrr) > 0:
            out["min_rr_from_zone_high"] = float(mrr)
    return out


def classify_entry_style(setup_type: str | None) -> EntryStyle:
    """Map ``setup_type`` / ORB tag to pullback vs breakout entry geometry."""
    s = (setup_type or "").strip().lower()
    if not s:
        return "pullback"
    if any(t in s for t in _PULLBACK_TOKENS) and not any(t in s for t in ("breakout", "orb", "breakdown")):
        return "pullback"
    if any(t in s for t in _BREAKOUT_TOKENS):
        return "breakout"
    return "pullback"


def resolve_anchor(
    *,
    preferred: str,
    vwap: float | None,
    prev_close: float | None,
    sma20: float | None,
    sma50: float | None,
    last: float | None,
) -> float | None:
    """Pick the structural anchor by preference, falling through to what's available."""
    pool: dict[str, float | None] = {
        "vwap": vwap,
        "sma20": sma20,
        "sma50": sma50,
        "prev_close": prev_close,
        "last": last,
    }
    order = [preferred, "vwap", "sma20", "sma50", "prev_close", "last"]
    seen: set[str] = set()
    for key in order:
        if key in seen:
            continue
        seen.add(key)
        v = pool.get(key)
        if isinstance(v, (int, float)) and float(v) > 0:
            return float(v)
    return None


def resolve_structure_entry_anchor(
    *,
    direction: str,
    last: float | None,
    atr: float | None,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str,
    preferred: str,
    vwap: float | None,
    prev_close: float | None,
    sma20: float | None,
    sma50: float | None,
    day_lo: float | None = None,
    day_hi: float | None = None,
    entry_style: EntryStyle = "pullback",
) -> float | None:
    """Entry-zone anchor from ranked structure zones (B80), with VWAP/SMA fallback.

    Pullback long: nearest support below ``last``.
    Pullback short: nearest resistance above ``last``.
    Breakout long: broken resistance at or just below ``last``.
    Breakout short: broken support at or just above ``last``.
    """
    legacy = resolve_anchor(
        preferred=preferred,
        vwap=vwap,
        prev_close=prev_close,
        sma20=sma20,
        sma50=sma50,
        last=last,
    )
    if last is None or last <= 0 or atr is None or atr <= 0 or not daily_bars:
        return legacy

    from stocvest.api.services.structure_engine import (
        nearest_broken_resistance_at_or_below,
        nearest_broken_support_at_or_above,
        nearest_resistance_above,
        nearest_support_below,
    )

    mode = str(trading_mode).strip().lower() or "swing"
    if entry_style == "breakout":
        if direction == "short":
            zone = nearest_broken_support_at_or_above(
                last=float(last),
                atr=float(atr),
                daily_bars=daily_bars,
                trading_mode=mode,
                extra_levels=[day_lo, vwap, sma20, sma50],
            )
        else:
            zone = nearest_broken_resistance_at_or_below(
                last=float(last),
                atr=float(atr),
                daily_bars=daily_bars,
                trading_mode=mode,
                extra_levels=[day_hi, vwap, sma20, sma50],
            )
        if zone is not None:
            return zone.level
        return legacy

    if direction == "short":
        zone = nearest_resistance_above(
            last=float(last),
            floor_above=float(last),
            atr=float(atr),
            daily_bars=daily_bars,
            trading_mode=mode,
            extra_levels=[day_hi, vwap, sma20, sma50],
        )
    else:
        zone = nearest_support_below(
            last=float(last),
            ceiling_below=float(last),
            atr=float(atr),
            daily_bars=daily_bars,
            trading_mode=mode,
            extra_levels=[day_lo, vwap, sma20, sma50],
        )

    if zone is not None:
        return zone.level
    return legacy


def resolve_structure_zone_level(
    *,
    direction: str,
    last: float | None,
    atr: float | None,
    daily_bars: list[dict[str, float]] | None,
    trading_mode: str,
    vwap: float | None = None,
    sma20: float | None = None,
    sma50: float | None = None,
    day_lo: float | None = None,
    day_hi: float | None = None,
) -> float | None:
    """Nearest ranked structure zone for stop anchoring (B80); no VWAP/SMA fallback."""
    if last is None or last <= 0 or atr is None or atr <= 0 or not daily_bars:
        return None

    from stocvest.api.services.structure_engine import (
        nearest_resistance_above,
        nearest_support_below,
    )

    mode = str(trading_mode).strip().lower() or "swing"
    if direction == "short":
        zone = nearest_resistance_above(
            last=float(last),
            floor_above=float(last),
            atr=float(atr),
            daily_bars=daily_bars,
            trading_mode=mode,
            extra_levels=[day_hi, vwap, sma20, sma50],
        )
    else:
        zone = nearest_support_below(
            last=float(last),
            ceiling_below=float(last),
            atr=float(atr),
            daily_bars=daily_bars,
            trading_mode=mode,
            extra_levels=[day_lo, vwap, sma20, sma50],
        )
    return zone.level if zone is not None else None


@dataclass(frozen=True)
class EntryZoneResult:
    low: float
    high: float
    quality: str  # "clean" | "clamped" | "no_clean_entry"
    worst_case_rr: float | None  # R/R measured from the worst-case edge of the zone
    entry_style: EntryStyle
    anchor: float | None
    entry_distance_atr: float | None
    zone_width_atr: float | None
    distance_tier: DistanceTier | None
    entry_quality_tier: QualityTier
    ideal_pullback_zone: dict[str, float] | None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def compute_ideal_pullback_band(
    *,
    anchor: float | None,
    atr: float | None,
    structure_band_atr_k: float,
) -> tuple[float, float] | None:
    """Symmetric structure band ``[anchor − δ, anchor + δ]`` for ideal pullback display."""
    if anchor is None or anchor <= 0 or atr is None or atr <= 0:
        return None
    delta = max(_EPS, float(structure_band_atr_k) * float(atr))
    return (round(anchor - delta, 4), round(anchor + delta, 4))


def compute_entry_distance_atr(
    *,
    last: float | None,
    anchor: float | None,
    atr: float | None,
) -> float | None:
    if last is None or last <= 0 or anchor is None or anchor <= 0 or atr is None or atr <= 0:
        return None
    return round(abs(float(last) - float(anchor)) / float(atr), 2)


def distance_tier_from_atr(distance_atr: float | None) -> DistanceTier | None:
    if distance_atr is None:
        return None
    if distance_atr < 0.5:
        return "ideal"
    if distance_atr <= 1.5:
        return "acceptable"
    return "chasing"


def zone_width_atr(*, low: float, high: float, atr: float | None) -> float | None:
    if atr is None or atr <= 0 or high <= low:
        return None
    return round((high - low) / float(atr), 2)


def score_entry_quality_tier(
    *,
    validation_quality: str,
    distance_tier: DistanceTier | None,
    worst_case_rr: float | None,
    zone_width_atr_val: float | None,
    min_rr: float,
) -> QualityTier:
    """High / medium / low desk read from worst-case R/R, distance, and band width."""
    if validation_quality == "no_clean_entry":
        return "low"
    score = 0
    if distance_tier == "ideal":
        score += 2
    elif distance_tier == "acceptable":
        score += 1
    elif distance_tier == "chasing":
        score -= 2
    if worst_case_rr is not None:
        if worst_case_rr >= min_rr + 1.0:
            score += 1
        elif worst_case_rr < min_rr:
            score -= 2
    if zone_width_atr_val is not None:
        if zone_width_atr_val <= 0.8:
            score += 1
        elif zone_width_atr_val > 2.0:
            score -= 1
    if validation_quality == "clamped":
        score -= 1
    if score >= 3:
        return "high"
    if score >= 1:
        return "medium"
    return "low"


def compute_entry_zone(
    *,
    direction: str,
    last: float | None,
    anchor: float | None,
    atr: float | None,
    max_width_pct: float,
    min_width_pct: float,
    atr_k: float = 1.0,
    max_extension_gamma: float = 2.5,
    breakout_band_atr_k: float = 0.6,
    entry_style: EntryStyle = "pullback",
) -> tuple[float, float] | None:
    """A tight band around the actionable entry (pre-validation).

    Pullback long: ``[lower, last]`` with ``lower`` toward anchor, capped by
    ``max_extension_gamma × ATR`` below ``last`` and pct rails.

    Breakout long: ``[anchor, anchor + δ]`` with δ = ``breakout_band_atr_k × ATR``
    (tight above the broken level — does not stretch to ``last``).

    Short: mirrored.
    """
    if last is None or last <= 0:
        return None
    max_w = max(_EPS, float(max_width_pct) * last)
    min_w = max(_EPS, min(float(min_width_pct) * last, max_w))
    natural = _clamp((atr_k * atr) if (atr and atr > 0) else min_w, min_w, max_w)
    gamma_ext = (max_extension_gamma * atr) if (atr and atr > 0) else max_w
    breakout_delta = _clamp(
        (breakout_band_atr_k * atr) if (atr and atr > 0) else natural,
        min_w,
        max_w,
    )

    if entry_style == "breakout" and anchor is not None and anchor > 0:
        if direction == "short":
            upper = anchor
            lower = anchor - breakout_delta
            return (round(lower, 4), round(upper, 4))
        lower = anchor
        upper = anchor + breakout_delta
        return (round(lower, 4), round(upper, 4))

    if direction == "short":
        upper_cap = last + min(gamma_ext, max_w)
        if anchor is not None and anchor > last:
            upper = _clamp(anchor, last + min_w, last + max_w)
            upper = min(upper, upper_cap)
        else:
            upper = min(last + natural, upper_cap)
        return (round(last, 4), round(upper, 4))

    # pullback long
    lower_cap = last - min(gamma_ext, max_w)
    if anchor is not None and anchor < last:
        lower = _clamp(anchor, last - max_w, last - min_w)
        lower = max(lower, lower_cap)
    else:
        lower = max(last - natural, lower_cap)
    return (round(lower, 4), round(last, 4))


def validate_entry_zone(
    *,
    low: float,
    high: float,
    stop: float | None,
    target_1: float | None,
    direction: str,
    min_rr_from_zone_high: float,
) -> EntryZoneResult:
    """Enforce stop / T1 / worst-case-R/R invariants, clamping the far edge inward."""
    lo, hi, quality, worst = _validate_entry_zone_bounds(
        low=low,
        high=high,
        stop=stop,
        target_1=target_1,
        direction=direction,
        min_rr_from_zone_high=min_rr_from_zone_high,
    )
    return EntryZoneResult(
        low=lo,
        high=hi,
        quality=quality,
        worst_case_rr=worst,
        entry_style="pullback",
        anchor=None,
        entry_distance_atr=None,
        zone_width_atr=None,
        distance_tier=None,
        entry_quality_tier="medium",
        ideal_pullback_zone=None,
    )


def _validate_entry_zone_bounds(
    *,
    low: float,
    high: float,
    stop: float | None,
    target_1: float | None,
    direction: str,
    min_rr_from_zone_high: float,
) -> tuple[float, float, str, float | None]:
    """Enforce stop / T1 / worst-case-R/R invariants, clamping the far edge inward."""
    quality: ValidationQuality = "clean"
    orig_lo, orig_hi = float(low), float(high)
    lo, hi = orig_lo, orig_hi
    floor = float(min_rr_from_zone_high)

    if direction == "short":
        if stop is not None and hi >= stop:
            hi = stop - _EPS
            quality = "clamped"
        if target_1 is not None and stop is not None and stop > target_1:
            need = (target_1 + floor * stop) / (1.0 + floor)
            if lo < need:
                lo = need
                quality = "clamped"
        risk = (stop - lo) if stop is not None else None
        reward = (lo - target_1) if target_1 is not None else None
        worst = (reward / risk) if (risk and risk > _EPS and reward is not None and reward > 0) else None
        if hi <= lo or (worst is not None and worst < floor - 1e-3):
            quality = "no_clean_entry"
            if hi <= lo:
                lo, hi = orig_lo, orig_hi
                risk = (stop - lo) if stop is not None else None
                reward = (lo - target_1) if target_1 is not None else None
                worst = (
                    (reward / risk) if (risk and risk > _EPS and reward is not None and reward > 0) else None
                )
        return (
            round(min(lo, hi), 4),
            round(max(lo, hi), 4),
            quality,
            round(worst, 2) if worst else None,
        )

    if stop is not None and lo <= stop:
        lo = stop + _EPS
        quality = "clamped"
    if target_1 is not None and stop is not None and target_1 > stop:
        high_max = (target_1 + floor * stop) / (1.0 + floor)
        if hi > high_max:
            hi = high_max
            quality = "clamped"
        if hi >= target_1:
            hi = target_1 - _EPS
            quality = "clamped"
    risk = (hi - stop) if stop is not None else None
    reward = (target_1 - hi) if target_1 is not None else None
    worst = (reward / risk) if (risk and risk > _EPS and reward is not None and reward > 0) else None
    if hi <= lo or (worst is not None and worst < floor - 1e-3):
        quality = "no_clean_entry"
        if hi <= lo:
            lo, hi = orig_lo, orig_hi
            risk = (hi - stop) if stop is not None else None
            reward = (target_1 - hi) if target_1 is not None else None
            worst = (reward / risk) if (risk and risk > _EPS and reward is not None and reward > 0) else None
    return (
        round(min(lo, hi), 4),
        round(max(lo, hi), 4),
        quality,
        round(worst, 2) if worst else None,
    )


def resolve_entry_zone(
    *,
    direction: str,
    last: float | None,
    stop: float | None,
    target_1: float | None,
    anchor: float | None,
    atr: float | None,
    config: dict,
    entry_style: EntryStyle = "pullback",
) -> EntryZoneResult | None:
    """Convenience: compute the band then validate/clamp it. ``config`` is the dict
    returned by :func:`config_for_mode`."""
    raw = compute_entry_zone(
        direction=direction,
        last=last,
        anchor=anchor,
        atr=atr,
        max_width_pct=float(config["max_width_pct"]),
        min_width_pct=float(config["min_width_pct"]),
        atr_k=float(config.get("atr_k", 1.0)),
        max_extension_gamma=float(config.get("max_extension_gamma", 2.5)),
        breakout_band_atr_k=float(config.get("breakout_band_atr_k", 0.6)),
        entry_style=entry_style,
    )
    if raw is None:
        return None
    lo, hi, quality, worst = _validate_entry_zone_bounds(
        low=raw[0],
        high=raw[1],
        stop=stop,
        target_1=target_1,
        direction=direction,
        min_rr_from_zone_high=float(config["min_rr_from_zone_high"]),
    )
    dist_atr = compute_entry_distance_atr(last=last, anchor=anchor, atr=atr)
    width_atr = zone_width_atr(low=lo, high=hi, atr=atr)
    dist_tier = distance_tier_from_atr(dist_atr)
    ideal = compute_ideal_pullback_band(
        anchor=anchor,
        atr=atr,
        structure_band_atr_k=float(config.get("structure_band_atr_k", config.get("atr_k", 1.0))),
    )
    ideal_dict = {"low": ideal[0], "high": ideal[1]} if ideal else None
    eq_tier = score_entry_quality_tier(
        validation_quality=quality,
        distance_tier=dist_tier,
        worst_case_rr=worst,
        zone_width_atr_val=width_atr,
        min_rr=float(config["min_rr_from_zone_high"]),
    )
    return EntryZoneResult(
        low=lo,
        high=hi,
        quality=quality,
        worst_case_rr=worst,
        entry_style=entry_style,
        anchor=round(anchor, 4) if anchor is not None else None,
        entry_distance_atr=dist_atr,
        zone_width_atr=width_atr,
        distance_tier=dist_tier,
        entry_quality_tier=eq_tier,
        ideal_pullback_zone=ideal_dict,
    )
