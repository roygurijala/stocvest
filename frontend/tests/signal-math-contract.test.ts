import { describe, expect, it } from "vitest";

import {
  DIRECTIONAL_SCORE_NEUTRAL,
  LAYER_SCORE_NEUTRAL,
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
  ratioToLayerCount
} from "@/lib/signal-math/contract";

describe("signal math contract", () => {
  it("pins the canonical six-layer set and anchors", () => {
    expect(SIGNAL_LAYERS).toEqual(["technical", "news", "macro", "sector", "geopolitical", "internals"]);
    expect(SIGNAL_LAYER_COUNT).toBe(6);
    expect(LAYER_SCORE_NEUTRAL).toBe(50);
    expect(DIRECTIONAL_SCORE_NEUTRAL).toBe(0);
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
});
