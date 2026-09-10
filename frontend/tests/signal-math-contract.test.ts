import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSITION_COMPOSITE_WEIGHTS,
  DIRECTIONAL_SCORE_NEUTRAL,
  LAYER_SCORE_NEUTRAL,
  POSITION_GATE_CATALOG,
  POSITION_SIGNAL_LAYERS,
  POSITION_SIGNAL_LAYER_COUNT,
  SIGNAL_LAYERS,
  SIGNAL_LAYER_COUNT,
  clampDirectionalScore,
  clampLayerScore,
  clampUnit,
  directionalSign,
  directionalToLayerScore,
  directionalVerdict,
  layerScoreDirection,
  layerScoreToDirectional,
  normalizeToUnit,
  ratioToLayerCount,
  signalLayerCountForMode,
  signalLayersForMode,
  validateCompositeWeights
} from "@/lib/signal-math/contract";

describe("signal math contract", () => {
  it("pins the canonical six-layer set and anchors", () => {
    expect(SIGNAL_LAYERS).toEqual(["technical", "news", "macro", "sector", "geopolitical", "internals"]);
    expect(SIGNAL_LAYER_COUNT).toBe(6);
    expect(LAYER_SCORE_NEUTRAL).toBe(50);
    expect(DIRECTIONAL_SCORE_NEUTRAL).toBe(0);
  });

  it("defines position seven-layer set with fundamentals first", () => {
    expect(POSITION_SIGNAL_LAYERS[0]).toBe("fundamentals");
    expect(POSITION_SIGNAL_LAYER_COUNT).toBe(7);
    expect(signalLayerCountForMode("position")).toBe(7);
    expect(signalLayersForMode("position")).toEqual([...POSITION_SIGNAL_LAYERS]);
  });

  it("validates default position composite weights", () => {
    const total = Object.values(DEFAULT_POSITION_COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
    const v = validateCompositeWeights(DEFAULT_POSITION_COMPOSITE_WEIGHTS, "position");
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("documents position gate catalog keys", () => {
    expect(POSITION_GATE_CATALOG.min_rr_t1).toMatch(/1\.5/);
    expect(POSITION_GATE_CATALOG.geometry_tradeable).toBeTruthy();
  });

  it("clamps each scale to its range", () => {
    expect(clampLayerScore(140)).toBe(100);
    expect(clampLayerScore(-5)).toBe(0);
    expect(clampDirectionalScore(2)).toBe(1);
    expect(clampDirectionalScore(-2)).toBe(-1);
    expect(clampUnit(1.4)).toBe(1);
    expect(clampUnit(-0.2)).toBe(0);
  });

  it("treats the neutral anchor as no direction", () => {
    expect(layerScoreDirection(50)).toBe(0);
    expect(layerScoreDirection(50.01)).toBe(1);
    expect(layerScoreDirection(49.99)).toBe(-1);
    expect(directionalSign(0)).toBe(0);
    expect(directionalSign(0.01)).toBe(1);
    expect(directionalSign(-0.01)).toBe(-1);
  });

  it("maps directional scores to verdicts at the ±0.20 threshold", () => {
    expect(directionalVerdict(0.2)).toBe("bullish");
    expect(directionalVerdict(-0.2)).toBe("bearish");
    expect(directionalVerdict(0.1)).toBe("neutral");
  });

  it("maps alignment ratio to whole-layer counts", () => {
    expect(ratioToLayerCount(0)).toBe(0);
    expect(ratioToLayerCount(0.5)).toBe(3);
    expect(ratioToLayerCount(1)).toBe(6);
    expect(ratioToLayerCount(1.5)).toBe(6);
    expect(ratioToLayerCount(-1)).toBe(0);
    expect(ratioToLayerCount(0.5, undefined, "position")).toBe(4);
  });

  it("normalizes magnitudes against a reference scale", () => {
    expect(normalizeToUnit(5, 10)).toBe(0.5);
    expect(normalizeToUnit(-5, 10)).toBe(0.5);
    expect(normalizeToUnit(20, 10)).toBe(1);
    expect(normalizeToUnit(5, 0)).toBe(0);
  });

  it("converts between scales at the anchors", () => {
    expect(layerScoreToDirectional(50)).toBe(0);
    expect(layerScoreToDirectional(100)).toBe(1);
    expect(layerScoreToDirectional(0)).toBe(-1);
    expect(directionalToLayerScore(0)).toBe(50);
    expect(directionalToLayerScore(1)).toBe(100);
    expect(directionalToLayerScore(-1)).toBe(0);
  });

  it("rejects invalid composite weight maps", () => {
    expect(validateCompositeWeights(null, "swing").ok).toBe(false);
    expect(validateCompositeWeights({ technical: 1 }, "swing").ok).toBe(false);
    expect(validateCompositeWeights({ fundamentals: 0.5, technical: 0.5 }, "position").ok).toBe(false);
  });
});
