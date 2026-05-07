"""Indicator scope categories — intraday vs swing chip enforcement."""

from __future__ import annotations

import re
from enum import Enum

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


class IndicatorScope(str, Enum):
    INTRADAY_ONLY = "intraday_only"
    SWING_ONLY = "swing_only"
    DUAL_SCOPE = "dual_scope"


INTRADAY_ONLY_INDICATORS: set[str] = {
    "vwap above",
    "vwap below",
    "above vwap",
    "below vwap",
    "vwap forming",
    "vwap starts at 9:30 et",
    "vwap (rth closed)",
    "ema9 bounce (session)",
    "ema9 rejection (session)",
    "ema9 bounce",
    "9 ema bounce",
    "9 ema rejection",
    "fast ema bounce (session)",
    "fast ema rejection (session)",
    "orb long",
    "orb short",
    "orb forming",
    "orb breakout long",
    "orb breakout short",
    "orb complete",
    "orb locked",
    "inside orb",
    "opening range breakout",
    "opening drive",
    "opening drive up",
    "opening drive down",
    "trend continuation (session orb)",
    "trend breakdown (session orb)",
    "pullback to fast ema (session)",
}

SWING_ONLY_INDICATORS: set[str] = {
    "above sma50",
    "below sma50",
    "above sma200",
    "below sma200",
    "above 50-day ma",
    "below 50-day ma",
    "above 200-day ma",
    "below 200-day ma",
    "golden cross",
    "death cross",
    "ema crossover (daily)",
    "daily ema crossover",
    "weekly rsi recovering",
    "weekly rsi overbought",
    "weekly rsi oversold",
    "hh/hl uptrend",
    "lh/ll downtrend",
    "higher highs",
    "higher lows",
    "base formation",
    "accumulating",
    "distributing",
    "near 52w high",
    "near 52-week high",
    "volume expansion",
    "volume contraction",
}

DUAL_SCOPE_INDICATORS: set[str] = {
    "rsi",
    "ema9 (daily)",
    "ema20 (daily)",
    "held above 9-dma",
    "below 9-dma",
}

SWING_CHIP_RENAME: dict[str, str] = {
    "ema9 bounce": "EMA9 Bounce (Daily)",
    "ema9 rejection": "EMA9 Rejection (Daily)",
    "ema20 cross": "EMA20 Cross (Daily)",
    "ema50 cross": "EMA50 Cross (Daily)",
    "9 ema bounce": "EMA9 Bounce (Daily)",
    "9 ema rejection": "EMA9 Rejection (Daily)",
    "above ema20": "Above EMA20 (Daily)",
    "below ema20": "Below EMA20 (Daily)",
}

SWING_FORBIDDEN_PHRASES = (
    "(session)",
    "VWAP",
    "ORB",
    "opening range",
    "intraday",
)


def is_chip_allowed(chip: str, mode: str) -> bool:
    """Return True if chip may appear on a card for the given mode (``day`` / ``swing``)."""
    chip_lower = chip.lower().strip()
    m = mode.strip().lower()

    if "vwap" in chip_lower and "daily" not in chip_lower:
        return m == "day"

    for intraday_indicator in INTRADAY_ONLY_INDICATORS:
        if intraday_indicator not in chip_lower:
            continue
        # Bare EMA bounce/rejection strings overlap swing rename targets — daily-qualified chips are swing-safe.
        if intraday_indicator in (
            "ema9 bounce",
            "9 ema bounce",
            "ema9 rejection",
            "9 ema rejection",
        ) and ("(daily)" in chip_lower or "daily" in chip_lower):
            continue
        return m == "day"

    for swing_indicator in SWING_ONLY_INDICATORS:
        if swing_indicator in chip_lower:
            return m == "swing"

    return True


def filter_chips_by_mode(chips: list[str], mode: str) -> list[str]:
    """Hard gate: drop chips invalid for mode."""
    return [c for c in chips if is_chip_allowed(c, mode)]


def validate_chip_for_swing(chip: str) -> bool:
    """Strict swing-card safety check (catches labels not in the taxonomy sets)."""
    chip_lower = chip.lower()

    session_markers = [
        "(session)",
        "session",
        "intraday",
        "orb",
        "opening range",
        "opening drive",
    ]
    for marker in session_markers:
        if marker in chip_lower:
            return False

    if "vwap" in chip_lower and "daily" not in chip_lower:
        return False

    if "ema9" in chip_lower or "9 ema" in chip_lower:
        if "(daily)" not in chip_lower and "9-dma" not in chip_lower:
            return False

    return True


def apply_swing_chip_labels(chips: list[str]) -> list[str]:
    """Qualify ambiguous swing chips with an explicit daily timeframe."""
    result: list[str] = []
    for chip in chips:
        chip_lower = chip.lower().strip()
        renamed = False
        for original, replacement in SWING_CHIP_RENAME.items():
            if original in chip_lower:
                result.append(replacement)
                renamed = True
                break
        if renamed:
            continue
        m = re.match(r"^rsi\s+(\d+(?:\.\d+)?)\s*$", chip_lower)
        if m:
            result.append(f"RSI {float(m.group(1)):.0f} (Daily)")
            continue
        if re.match(r"^rsi\s+(\d+(?:\.\d+)?)\s*\(daily\)\s*$", chip_lower):
            result.append(chip)
            continue
        result.append(chip)
    return result


def sanitize_swing_reasoning_text(reasoning: str, *, symbol: str = "") -> str:
    """Remove intraday-only phrasing from swing reasoning; log if stripping occurred."""
    out = reasoning
    low = out.lower()
    for phrase in SWING_FORBIDDEN_PHRASES:
        if phrase.lower() in low:
            _LOG.warning("swing_reasoning_contains_intraday_term symbol=%s phrase=%s", symbol, phrase)
            out = out.replace(phrase, "")
            low = out.lower()
    out = re.sub(r"\bsession\b", "", out, flags=re.IGNORECASE)
    return " ".join(out.split())


def finalize_swing_technical_chips(
    symbol: str,
    raw_chips: list[str],
) -> list[str]:
    """Rename ambiguous swing chips, then filter intraday-only labels."""
    all_chips = list(raw_chips)
    labeled = apply_swing_chip_labels(all_chips)
    swing_chips = filter_chips_by_mode(labeled, "swing")
    swing_chips = [c for c in swing_chips if validate_chip_for_swing(c)]
    dropped = set(labeled) - set(swing_chips)
    if dropped:
        _LOG.info(
            "intraday_chips_suppressed symbol=%s mode=swing removed=%s",
            symbol,
            list(dropped),
        )
    return swing_chips


def finalize_day_technical_chips(
    symbol: str,
    raw_chips: list[str],
) -> list[str]:
    """Symmetric gate: strip swing-only chips from intraday cards."""
    all_chips = list(raw_chips)
    day_chips = filter_chips_by_mode(all_chips, "day")
    removed = set(all_chips) - set(day_chips)
    if removed:
        _LOG.info(
            "swing_only_chips_suppressed symbol=%s mode=day removed=%s",
            symbol,
            list(removed),
        )
    return day_chips
