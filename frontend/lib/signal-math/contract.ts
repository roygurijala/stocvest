/**
 * STOCVEST Signal Math Contract (frontend mirror).
 *
 * Mirror of `stocvest/signals/signal_math_contract.py`. Keep the two in sync.
 *
 * Three score scales coexist by design; mixing them is the most common signal-math
 * bug, so they are named and bounded here:
 *
 * - **Layer / UI scale** — `0..100`, neutral `50`. Per-layer reads shown in the UI.
 *   Above 50 = bullish lean, below 50 = bearish lean, exactly 50 = no direction.
 * - **Directional scale** — `-1..+1`, neutral `0`. Composite blend (sign = direction).
 * - **Unit scale** — `0..1` for confidence / alignment ratio / normalized magnitude.
 *
 * Neutral rule (load-bearing): a value exactly on the neutral anchor contributes
 * **no direction** — never a defaulted bullish/bearish lean.
 */

export const LAYER_SCORE_MIN = 0;
export const LAYER_SCORE_MAX = 100;
export const LAYER_SCORE_NEUTRAL = 50;

export const DIRECTIONAL_SCORE_MIN = -1;
export const DIRECTIONAL_SCORE_MAX = 1;
export const DIRECTIONAL_SCORE_NEUTRAL = 0;
export const DIRECTIONAL_VERDICT_THRESHOLD = 0.2;

export const UNIT_MIN = 0;
export const UNIT_MAX = 1;

/** Canonical six-layer set (must match Python `SIGNAL_LAYERS` / `MATURATION_LAYER_KEYS`). */
export const SIGNAL_LAYERS = ["technical", "news", "macro", "sector", "geopolitical", "internals"] as const;
export type SignalLayer = (typeof SIGNAL_LAYERS)[number];
export const SIGNAL_LAYER_COUNT = SIGNAL_LAYERS.length;

export type Direction = -1 | 0 | 1;
export type Verdict = "bullish" | "bearish" | "neutral";

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function clampLayerScore(value: number): number {
  return clamp(value, LAYER_SCORE_MIN, LAYER_SCORE_MAX);
}

export function clampDirectionalScore(value: number): number {
  return clamp(value, DIRECTIONAL_SCORE_MIN, DIRECTIONAL_SCORE_MAX);
}

export function clampUnit(value: number): number {
  return clamp(value, UNIT_MIN, UNIT_MAX);
}

/** 0..100 layer score → -1/0/+1. Exactly 50 (neutral) returns 0. */
export function layerScoreDirection(score: number): Direction {
  if (score > LAYER_SCORE_NEUTRAL) return 1;
  if (score < LAYER_SCORE_NEUTRAL) return -1;
  return 0;
}

/** -1..+1 directional score → -1/0/+1 (neutral at 0). */
export function directionalSign(score: number): Direction {
  if (score > DIRECTIONAL_SCORE_NEUTRAL) return 1;
  if (score < DIRECTIONAL_SCORE_NEUTRAL) return -1;
  return 0;
}

/** -1..+1 directional score → bullish/bearish/neutral. */
export function directionalVerdict(score: number, threshold: number = DIRECTIONAL_VERDICT_THRESHOLD): Verdict {
  if (score >= threshold) return "bullish";
  if (score <= -threshold) return "bearish";
  return "neutral";
}

/** Alignment ratio (0..1) → whole-layer count (0..total). */
export function ratioToLayerCount(ratio: number, total: number = SIGNAL_LAYER_COUNT): number {
  return Math.max(0, Math.min(total, Math.round(clampUnit(ratio) * total)));
}

/** `|magnitude| / scale` clamped to 0..1. Returns 0 for a non-positive scale. */
export function normalizeToUnit(magnitude: number, scale: number): number {
  if (scale <= 0) return 0;
  return clampUnit(Math.abs(magnitude) / scale);
}

/** 0..100 layer score → -1..+1 directional score (50 → 0). */
export function layerScoreToDirectional(score: number): number {
  return clampDirectionalScore((clampLayerScore(score) - LAYER_SCORE_NEUTRAL) / LAYER_SCORE_NEUTRAL);
}

/** -1..+1 directional score → 0..100 layer score (0 → 50). */
export function directionalToLayerScore(score: number): number {
  return clampLayerScore(LAYER_SCORE_NEUTRAL + clampDirectionalScore(score) * LAYER_SCORE_NEUTRAL);
}
