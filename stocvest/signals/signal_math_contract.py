"""STOCVEST Signal Math Contract — single source of truth for signal scoring math.

Three score scales coexist **by design**; mixing them is the most common signal-math
bug, so they are named and bounded here and enforced across scanner / watchlist /
scenario / frontend:

* **Layer / UI scale** — ``0..100`` with neutral at ``50``. Produced by per-layer
  analyzers (e.g. ``technical_analyzer``) and surfaced in the UI as a 0-100 read
  ("Trade Readiness 0-100, never 0.0-1.0"). Above 50 = bullish lean, below = bearish.
* **Directional scale** — ``-1.0..+1.0`` with neutral at ``0``. Used by the composite
  engine (``composite_score``) to blend layer reads: sign = direction, magnitude =
  conviction. Verdict thresholds are ``±DIRECTIONAL_VERDICT_THRESHOLD``.
* **Unit scale** — ``0..1`` for confidence, alignment ratios, and normalized
  magnitudes (e.g. breakout strength).

Neutral handling rule (load-bearing): a value sitting exactly on the neutral anchor
contributes **no direction** (``0``) — never a defaulted bullish/bearish lean.

The canonical six-layer set is sourced from the watchlist/evidence contract
(``MATURATION_LAYER_KEYS``) so the layer definitions never drift between modules.
"""

from __future__ import annotations

from stocvest.models.watchlist import MATURATION_LAYER_KEYS

# --- Layer / UI score scale (0..100, neutral 50) ------------------------------
LAYER_SCORE_MIN = 0.0
LAYER_SCORE_MAX = 100.0
LAYER_SCORE_NEUTRAL = 50.0

# --- Directional composite scale (-1..+1, neutral 0) --------------------------
DIRECTIONAL_SCORE_MIN = -1.0
DIRECTIONAL_SCORE_MAX = 1.0
DIRECTIONAL_SCORE_NEUTRAL = 0.0
# Default |score| at/above which the composite reads bullish/bearish (else neutral).
DIRECTIONAL_VERDICT_THRESHOLD = 0.20

# --- Unit scale (0..1) — confidence, alignment ratio, normalized magnitude -----
UNIT_MIN = 0.0
UNIT_MAX = 1.0

# --- Canonical layer set ------------------------------------------------------
SIGNAL_LAYERS: tuple[str, ...] = tuple(MATURATION_LAYER_KEYS)
SIGNAL_LAYER_COUNT: int = len(SIGNAL_LAYERS)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clamp_layer_score(value: float) -> float:
    """Clamp to the 0..100 layer/UI scale."""
    return clamp(float(value), LAYER_SCORE_MIN, LAYER_SCORE_MAX)


def clamp_directional_score(value: float) -> float:
    """Clamp to the -1..+1 directional scale."""
    return clamp(float(value), DIRECTIONAL_SCORE_MIN, DIRECTIONAL_SCORE_MAX)


def clamp_unit(value: float) -> float:
    """Clamp to the 0..1 unit scale."""
    return clamp(float(value), UNIT_MIN, UNIT_MAX)


def layer_score_direction(score: float) -> int:
    """0..100 layer score → ``-1`` / ``0`` / ``+1``.

    Exactly ``50`` (neutral) returns ``0`` — no direction is assumed.
    """
    s = float(score)
    if s > LAYER_SCORE_NEUTRAL:
        return 1
    if s < LAYER_SCORE_NEUTRAL:
        return -1
    return 0


def directional_sign(score: float) -> int:
    """-1..+1 directional score → ``-1`` / ``0`` / ``+1`` (neutral at 0)."""
    s = float(score)
    if s > DIRECTIONAL_SCORE_NEUTRAL:
        return 1
    if s < DIRECTIONAL_SCORE_NEUTRAL:
        return -1
    return 0


def directional_verdict(score: float, threshold: float = DIRECTIONAL_VERDICT_THRESHOLD) -> str:
    """-1..+1 directional score → ``"bullish"`` / ``"bearish"`` / ``"neutral"``."""
    s = float(score)
    if s >= threshold:
        return "bullish"
    if s <= -threshold:
        return "bearish"
    return "neutral"


def ratio_to_layer_count(ratio: float, total: int = SIGNAL_LAYER_COUNT) -> int:
    """Map an alignment ratio (0..1) to a whole-layer count (0..total)."""
    return int(max(0, min(total, round(clamp_unit(ratio) * total))))


def normalize_to_unit(magnitude: float, scale: float) -> float:
    """``|magnitude| / scale`` clamped to 0..1.

    Use to normalize a raw magnitude against a reference range (e.g. breakout
    penetration vs the opening-range width). Returns 0 for a non-positive scale.
    """
    if scale <= 0:
        return 0.0
    return clamp_unit(abs(float(magnitude)) / float(scale))


def layer_score_to_directional(score: float) -> float:
    """0..100 layer score → -1..+1 directional score (50 → 0)."""
    return clamp_directional_score((clamp_layer_score(score) - LAYER_SCORE_NEUTRAL) / LAYER_SCORE_NEUTRAL)


def directional_to_layer_score(score: float) -> float:
    """-1..+1 directional score → 0..100 layer score (0 → 50)."""
    return clamp_layer_score(LAYER_SCORE_NEUTRAL + clamp_directional_score(score) * LAYER_SCORE_NEUTRAL)
