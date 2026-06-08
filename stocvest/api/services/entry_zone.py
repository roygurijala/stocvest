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

_EPS = 1e-6


# --- Config (defaults mirror stocvest.config.signal_parameters.EntryZoneParameters) ---
DEFAULTS: dict[str, dict[str, float | str]] = {
    "day": {"max_width_pct": 0.005, "min_width_pct": 0.002, "preferred_anchor": "vwap", "atr_k": 0.5},
    "swing": {"max_width_pct": 0.020, "min_width_pct": 0.005, "preferred_anchor": "sma20", "atr_k": 1.0},
}
DEFAULT_MIN_RR_FROM_ZONE_HIGH: float = 1.5


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
            for k in ("max_width_pct", "min_width_pct", "atr_k"):
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


@dataclass(frozen=True)
class EntryZoneResult:
    low: float
    high: float
    quality: str  # "clean" | "clamped" | "no_clean_entry"
    worst_case_rr: float | None  # R/R measured from the worst-case edge of the zone


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def compute_entry_zone(
    *,
    direction: str,
    last: float | None,
    anchor: float | None,
    atr: float | None,
    max_width_pct: float,
    min_width_pct: float,
    atr_k: float = 1.0,
) -> tuple[float, float] | None:
    """A tight band around the actionable entry (pre-validation).

    Long: enter on a pullback between the anchor (support) and current price →
    ``[lower, last]`` with ``lower`` clamped between ``last − max_width`` and
    ``last − min_width``. If the anchor is too far below (price extended) we fall
    back to a ``max_width`` band just under price.

    Short: enter on a bounce between current price and the anchor (resistance) →
    ``[last, upper]`` (mirrored).
    """
    if last is None or last <= 0:
        return None
    max_w = max(_EPS, float(max_width_pct) * last)
    min_w = max(_EPS, min(float(min_width_pct) * last, max_w))
    natural = _clamp((atr_k * atr) if (atr and atr > 0) else min_w, min_w, max_w)

    if direction == "short":
        if anchor is not None and anchor > last:
            upper = _clamp(anchor, last + min_w, last + max_w)
        else:
            upper = last + natural
        return (round(last, 4), round(upper, 4))

    # long (default)
    if anchor is not None and anchor < last:
        lower = _clamp(anchor, last - max_w, last - min_w)
    else:
        lower = last - natural
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
    quality = "clean"
    lo, hi = float(low), float(high)
    floor = float(min_rr_from_zone_high)

    if direction == "short":
        # Worst-case entry for a short is the zone LOW (you sell cheapest); target is below.
        if stop is not None and hi >= stop:
            hi = stop - _EPS
            quality = "clamped"
        if target_1 is not None and stop is not None and stop > target_1:
            # low_min s.t. (low − t1) / (stop − low) == floor
            need = (target_1 + floor * stop) / (1.0 + floor)
            if lo < need:
                lo = need
                quality = "clamped"
        risk = (stop - lo) if stop is not None else None
        reward = (lo - target_1) if target_1 is not None else None
        worst = (reward / risk) if (risk and risk > _EPS and reward is not None and reward > 0) else None
        if hi <= lo or (worst is not None and worst < floor - 1e-3):
            quality = "no_clean_entry"
        return EntryZoneResult(round(min(lo, hi), 4), round(max(lo, hi), 4), quality, round(worst, 2) if worst else None)

    # long (default): worst-case entry is the zone HIGH (you pay the most).
    if stop is not None and lo <= stop:
        lo = stop + _EPS
        quality = "clamped"
    if target_1 is not None and stop is not None and target_1 > stop:
        # high_max s.t. (t1 − high) / (high − stop) == floor
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
    return EntryZoneResult(round(min(lo, hi), 4), round(max(lo, hi), 4), quality, round(worst, 2) if worst else None)


def resolve_entry_zone(
    *,
    direction: str,
    last: float | None,
    stop: float | None,
    target_1: float | None,
    anchor: float | None,
    atr: float | None,
    config: dict,
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
    )
    if raw is None:
        return None
    return validate_entry_zone(
        low=raw[0],
        high=raw[1],
        stop=stop,
        target_1=target_1,
        direction=direction,
        min_rr_from_zone_high=float(config["min_rr_from_zone_high"]),
    )
