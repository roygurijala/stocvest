"""Human-readable copy for alert emails (trigger slugs → labels)."""

from __future__ import annotations

import re

# Day / intraday scanner triggers (aligned with frontend DAY_TRIGGER_LABELS).
DAY_TRIGGER_LABELS: dict[str, str] = {
    "orb_breakout_long": "ORB Long ↑",
    "orb_breakout_short": "ORB Short ↓",
    "orb_retest_long": "ORB retest · dip buy",
    "orb_retest_short": "ORB retest · rally fade",
    "vwap_reclaim": "VWAP Reclaim",
    "vwap_rejection": "VWAP Rejection",
    "ema9_bounce": "EMA9 Bounce",
    "hod_breakout": "Session high expansion",
    "lod_breakdown": "Session low breakdown",
    "volume_surge": "Volume confirmation",
    "gap_hold_long": "Gap hold · upside follow-through",
    "gap_fade_short": "Gap fade · downside pressure",
}

SWING_TRIGGER_LABELS: dict[str, str] = {
    "ema9_bounce": "EMA9 Bounce (Daily)",
    "ema9_rejection": "EMA9 Rejection (Daily)",
    "ema_crossover_daily": "Daily EMA Crossover",
    "ema20_cross_above_50": "Daily EMA20 crossed above EMA50",
    "ema20_cross_below_50": "Daily EMA20 crossed below EMA50",
    "ema50_cross_above_200": "Daily EMA50 crossed above EMA200",
    "ema50_cross_below_200": "Daily EMA50 crossed below EMA200",
    "ema20_cross_above_200": "Daily EMA20 crossed above EMA200",
    "ema20_cross_below_200": "Daily EMA20 crossed below EMA200",
    "weekly_rsi_recovery": "Weekly RSI Recovery",
    "volume_expansion_breakout": "Volume Expansion (Daily)",
    "volume_expansion": "Volume Expansion (Daily)",
    "base_breakout": "Base Breakout (Daily)",
    "above_sma50": "Above 50-Day MA",
    "above_sma200": "Above 200-Day MA",
    "hh_hl_pattern": "Higher Highs / Higher Lows",
    "pattern_maturity": "Pattern maturity",
    "swing_composite": "Swing composite",
    "real_composite": "Day composite",
    "intraday_setup": "Intraday setup",
}


def _fallback_label(slug: str) -> str:
    s = slug.strip().lower().replace("-", "_")
    if not s:
        return ""
    return " ".join(part.capitalize() for part in s.split("_"))


def label_trigger_slug(slug: str, *, mode: str = "day") -> str:
    k = slug.strip().lower().replace("-", "_")
    if not k:
        return ""
    if mode == "day":
        return DAY_TRIGGER_LABELS.get(k) or SWING_TRIGGER_LABELS.get(k) or _fallback_label(k)
    return SWING_TRIGGER_LABELS.get(k) or _fallback_label(k)


def format_alert_pattern(pattern: str, *, mode: str = "day") -> str:
    """Space- or comma-separated trigger slugs → readable setup line."""
    raw = (pattern or "").strip()
    if not raw:
        return "Setup detected"
    parts = re.split(r"[\s,]+", raw)
    labels: list[str] = []
    seen: set[str] = set()
    for part in parts:
        p = part.strip().lower()
        if not p or p in seen:
            continue
        seen.add(p)
        label = label_trigger_slug(p, mode=mode)
        if label:
            labels.append(label)
    if not labels:
        return _fallback_label(raw.replace(" ", "_"))
    return " · ".join(labels)


def format_direction(direction: str) -> str:
    d = (direction or "").strip().lower()
    if d == "long":
        return "Long"
    if d == "short":
        return "Short"
    return d.capitalize() if d else "—"
