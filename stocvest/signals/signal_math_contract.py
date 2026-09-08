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

Desk modes (hard separation — ADR-004):
* **day** / **swing** — six shared layer types (``SIGNAL_LAYERS``).
* **position** — seven layers: scored **fundamentals** plus the six shared types
  (``POSITION_SIGNAL_LAYERS``). Position uses ``position_composite`` weight block.

The canonical six-layer set is sourced from the watchlist/evidence contract
(``MATURATION_LAYER_KEYS``) so the layer definitions never drift between modules.
"""

from __future__ import annotations

import math
from typing import Literal

from stocvest.models.watchlist import MATURATION_LAYER_KEYS

CompositeDeskMode = Literal["day", "swing", "position"]

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

# --- Canonical layer sets -------------------------------------------------------
# Swing/day composite + watchlist maturation (six layers).
SIGNAL_LAYERS: tuple[str, ...] = tuple(MATURATION_LAYER_KEYS)
SIGNAL_LAYER_COUNT: int = len(SIGNAL_LAYERS)

# Position desk (seven layers — fundamentals first).
POSITION_SIGNAL_LAYERS: tuple[str, ...] = (
    "fundamentals",
    "technical",
    "news",
    "macro",
    "sector",
    "geopolitical",
    "internals",
)
POSITION_SIGNAL_LAYER_COUNT: int = len(POSITION_SIGNAL_LAYERS)

SIGNAL_LAYERS_BY_MODE: dict[str, tuple[str, ...]] = {
    "day": SIGNAL_LAYERS,
    "swing": SIGNAL_LAYERS,
    "position": POSITION_SIGNAL_LAYERS,
}

# Composite blend weight keys (must sum to ~1.0 per mode).
SIX_LAYER_WEIGHT_KEYS: tuple[str, ...] = SIGNAL_LAYERS
POSITION_LAYER_WEIGHT_KEYS: tuple[str, ...] = POSITION_SIGNAL_LAYERS

WEIGHT_SUM_TARGET = 1.0
WEIGHT_SUM_TOLERANCE = 0.02

# ADR-004 default position blend (keep in sync with PositionCompositeParameters).
DEFAULT_POSITION_COMPOSITE_WEIGHTS: dict[str, float] = {
    "fundamentals": 0.32,
    "technical": 0.22,
    "macro": 0.15,
    "sector": 0.12,
    "news": 0.08,
    "geopolitical": 0.06,
    "internals": 0.05,
}

# Position desk gate catalog (geometry + desk entry — informational for UI/docs).
POSITION_GATE_CATALOG: dict[str, str] = {
    "min_layers": "At least min_available_layers (default 4 of 7) must be scorable.",
    "min_rr_t1": "Structure R/R to T1 must be >= min_rr_desk (default 1.5; env-adjusted).",
    "geometry_tradeable": "Stop/target geometry complete; stop >= 2× weekly ATR from entry.",
    "market_environment": "new_position_allowed must be true (crisis/stressed blocks new entries).",
    "neutral_verdict": "Neutral composite verdict never surfaces as desk-tradeable.",
    "entry_zone": "Execution-actionable requires price inside historical entry zone.",
    "fundamentals_degraded": "Degraded fundamentals excluded from composite blend but visible in pillars.",
}


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


def ratio_to_layer_count(
    ratio: float,
    total: int | None = None,
    *,
    mode: str | None = None,
) -> int:
    """Map an alignment ratio (0..1) to a whole-layer count (0..total).

    When ``total`` is omitted, resolves from ``mode`` (position → 7, else 6).
    """
    layer_total = total
    if layer_total is None:
        layer_total = signal_layer_count_for_mode(mode)
    return int(max(0, min(layer_total, round(clamp_unit(ratio) * layer_total))))


def signal_layers_for_mode(mode: str | None) -> tuple[str, ...]:
    """Return canonical layer ids for a desk mode (defaults to swing/day six-layer set)."""
    key = str(mode or "swing").strip().lower()
    return SIGNAL_LAYERS_BY_MODE.get(key, SIGNAL_LAYERS)


def signal_layer_count_for_mode(mode: str | None) -> int:
    return len(signal_layers_for_mode(mode))


def _finite_positive_weight(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    f = float(value)
    if not math.isfinite(f) or f < 0:
        return None
    return f


def composite_weights_from_block(block: object, *, mode: str | None) -> dict[str, float]:
    """Extract a layer→weight map from a composite parameter block."""
    desk = str(mode or "swing").strip().lower()
    if desk == "position":
        keys = POSITION_LAYER_WEIGHT_KEYS
        suffix = "_weight"
    else:
        keys = SIX_LAYER_WEIGHT_KEYS
        suffix = "_weight"
    out: dict[str, float] = {}
    for layer in keys:
        raw = getattr(block, f"{layer}{suffix}", None)
        w = _finite_positive_weight(raw)
        if w is not None:
            out[layer] = w
    return out


def validate_composite_weights(
    weights: dict[str, float] | None,
    *,
    mode: str | None,
) -> tuple[bool, list[str]]:
    """Validate a composite weight map for ``mode`` (sum ≈ 1.0, known keys, non-negative)."""
    errors: list[str] = []
    desk = str(mode or "swing").strip().lower()
    expected = POSITION_LAYER_WEIGHT_KEYS if desk == "position" else SIX_LAYER_WEIGHT_KEYS
    if not weights:
        return False, ["missing_weights"]

    unknown = sorted(set(weights.keys()) - set(expected))
    if unknown:
        errors.append(f"unknown_layers:{','.join(unknown)}")

    missing = [layer for layer in expected if layer not in weights]
    if missing:
        errors.append(f"missing_layers:{','.join(missing)}")

    total = 0.0
    for layer in expected:
        raw = weights.get(layer)
        w = _finite_positive_weight(raw)
        if w is None:
            errors.append(f"invalid_weight:{layer}")
            continue
        total += w

    if not errors and abs(total - WEIGHT_SUM_TARGET) > WEIGHT_SUM_TOLERANCE:
        errors.append(f"weight_sum:{total:.4f}")

    return len(errors) == 0, errors


def normalize_composite_weights(weights: dict[str, float], *, mode: str | None) -> dict[str, float]:
    """Renormalize weights to sum 1.0; missing/invalid per-layer values use mode defaults."""
    desk = str(mode or "swing").strip().lower()
    expected = POSITION_LAYER_WEIGHT_KEYS if desk == "position" else SIX_LAYER_WEIGHT_KEYS
    defaults = (
        DEFAULT_POSITION_COMPOSITE_WEIGHTS if desk == "position" else DEFAULT_BASE_WEIGHTS_FALLBACK
    )
    cleaned: dict[str, float] = {}
    for layer in expected:
        w = _finite_positive_weight(weights.get(layer))
        if w is None:
            w = defaults.get(layer, 0.0)
        cleaned[layer] = w
    total = sum(cleaned.values())
    if total <= 0:
        if desk == "position":
            return dict(DEFAULT_POSITION_COMPOSITE_WEIGHTS)
        return dict(DEFAULT_BASE_WEIGHTS_FALLBACK)
    normalized = {layer: round(w / total, 6) for layer, w in cleaned.items()}
    drift = WEIGHT_SUM_TARGET - sum(normalized.values())
    if normalized and abs(drift) > 0:
        last = expected[-1]
        normalized[last] = round(normalized[last] + drift, 6)
    return normalized


# Fallback six-layer weights when normalization fails (mirrors composite_score defaults).
DEFAULT_BASE_WEIGHTS_FALLBACK: dict[str, float] = {
    "technical": 0.30,
    "news": 0.20,
    "sector": 0.15,
    "macro": 0.15,
    "geopolitical": 0.10,
    "internals": 0.10,
}


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
