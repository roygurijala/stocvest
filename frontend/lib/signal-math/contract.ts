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
 * Desk modes (ADR-004): day/swing use six layers; position adds scored fundamentals (7).
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

/** Canonical six-layer set (swing/day + watchlist maturation). */
export const SIGNAL_LAYERS = ["technical", "news", "macro", "sector", "geopolitical", "internals"] as const;
export type SignalLayer = (typeof SIGNAL_LAYERS)[number];
export const SIGNAL_LAYER_COUNT = SIGNAL_LAYERS.length;

/** Position desk seven-layer set (fundamentals first). */
export const POSITION_SIGNAL_LAYERS = [
  "fundamentals",
  "technical",
  "news",
  "macro",
  "sector",
  "geopolitical",
  "internals"
] as const;
export type PositionSignalLayer = (typeof POSITION_SIGNAL_LAYERS)[number];
export const POSITION_SIGNAL_LAYER_COUNT = POSITION_SIGNAL_LAYERS.length;

export type CompositeDeskMode = "day" | "swing" | "position";

export const SIGNAL_LAYERS_BY_MODE: Record<CompositeDeskMode, readonly string[]> = {
  day: SIGNAL_LAYERS,
  swing: SIGNAL_LAYERS,
  position: POSITION_SIGNAL_LAYERS
};

export const WEIGHT_SUM_TARGET = 1;
export const WEIGHT_SUM_TOLERANCE = 0.02;

export const DEFAULT_POSITION_COMPOSITE_WEIGHTS: Record<PositionSignalLayer, number> = {
  fundamentals: 0.32,
  technical: 0.22,
  macro: 0.15,
  sector: 0.12,
  news: 0.08,
  geopolitical: 0.06,
  internals: 0.05
};

/** Position desk gate catalog (informational — matches backend POSITION_GATE_CATALOG). */
export const POSITION_GATE_CATALOG: Record<string, string> = {
  min_layers: "At least min_available_layers (default 4 of 7) must be scorable.",
  min_rr_t1: "Structure R/R to T1 must be >= min_rr_desk (default 1.5; env-adjusted).",
  geometry_tradeable: "Stop/target geometry complete; stop >= 2× weekly ATR from entry.",
  market_environment: "new_position_allowed must be true (crisis/stressed blocks new entries).",
  neutral_verdict: "Neutral composite verdict never surfaces as desk-tradeable.",
  entry_zone: "Execution-actionable requires price inside historical entry zone.",
  fundamentals_degraded: "Degraded fundamentals excluded from composite blend but visible in pillars."
};

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

export function signalLayersForMode(mode?: CompositeDeskMode | string | null): readonly string[] {
  const key = String(mode ?? "swing").trim().toLowerCase() as CompositeDeskMode;
  return SIGNAL_LAYERS_BY_MODE[key] ?? SIGNAL_LAYERS;
}

export function signalLayerCountForMode(mode?: CompositeDeskMode | string | null): number {
  return signalLayersForMode(mode).length;
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
export function ratioToLayerCount(
  ratio: number,
  total?: number,
  mode?: CompositeDeskMode | string | null
): number {
  const layerTotal = total ?? signalLayerCountForMode(mode);
  return Math.max(0, Math.min(layerTotal, Math.round(clampUnit(ratio) * layerTotal)));
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

function finiteWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Validate composite weights for a desk mode (sum ≈ 1.0, known keys). */
export function validateCompositeWeights(
  weights: Record<string, number> | null | undefined,
  mode?: CompositeDeskMode | string | null
): { ok: boolean; errors: string[] } {
  const desk = String(mode ?? "swing").trim().toLowerCase();
  const expected =
    desk === "position" ? [...POSITION_SIGNAL_LAYERS] : [...SIGNAL_LAYERS];
  const errors: string[] = [];
  if (!weights || typeof weights !== "object") {
    return { ok: false, errors: ["missing_weights"] };
  }
  const keys = Object.keys(weights);
  for (const k of keys) {
    if (!expected.includes(k)) errors.push(`unknown_layers:${k}`);
  }
  for (const layer of expected) {
    if (!(layer in weights)) errors.push(`missing_layers:${layer}`);
    else if (finiteWeight(weights[layer]) == null) errors.push(`invalid_weight:${layer}`);
  }
  if (errors.length === 0) {
    const total = expected.reduce((sum, layer) => sum + (finiteWeight(weights[layer]) ?? 0), 0);
    if (Math.abs(total - WEIGHT_SUM_TARGET) > WEIGHT_SUM_TOLERANCE) {
      errors.push(`weight_sum:${total.toFixed(4)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
