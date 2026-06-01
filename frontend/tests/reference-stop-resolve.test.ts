import { describe, expect, test } from "vitest";
import {
  referenceStopAtrK,
  resolveMergedReferenceStop,
  resolveStructuralStopAnchor
} from "@/lib/scenario/reference-stop-resolve";

describe("reference-stop-resolve", () => {
  test("structural long anchor sits below support, not at VWAP cluster", () => {
    const structural = resolveStructuralStopAnchor({
      direction: "bullish",
      sessionLow: 98,
      sessionHigh: 102,
      vwap: 99.5,
      prevClose: 99,
      last: 100
    });
    expect(structural).toBeCloseTo(98 * 0.995, 4);
  });

  test("TSLA-style: stop below swing support, not at session/VWAP liquidity", () => {
    const structural = resolveStructuralStopAnchor({
      direction: "bullish",
      sessionLow: 424,
      sessionHigh: 445,
      vwap: 426,
      prevClose: 425,
      last: 427,
      swingLow: 420,
      zoneLo: 420
    });
    expect(structural).toBeCloseTo(420 * 0.995, 4);
    expect(structural!).toBeLessThan(422);
    expect(structural!).not.toBeCloseTo(423, 0);
  });

  test("without ATR, merged stop equals structural", () => {
    const structural = resolveStructuralStopAnchor({
      direction: "bullish",
      sessionLow: 98,
      sessionHigh: 102,
      vwap: 99.5,
      prevClose: 99,
      last: 100
    });
    const merged = resolveMergedReferenceStop({
      direction: "bullish",
      entry: 100,
      structuralStop: structural,
      atr: null,
      atrK: 1
    });
    expect(merged.stop).toBe(structural);
    expect(merged.usedAtrFloor).toBe(false);
  });

  test("long merge widens to ATR floor when structural is too tight", () => {
    // Structural above ATR floor (tighter for longs) — e.g. MSFT dip-style geometry.
    const structural = resolveStructuralStopAnchor({
      direction: "bullish",
      sessionLow: 99.2,
      sessionHigh: 102,
      vwap: 99.5,
      prevClose: 99,
      last: 100
    });
    const merged = resolveMergedReferenceStop({
      direction: "bullish",
      entry: 100,
      structuralStop: structural,
      atr: 4,
      atrK: 0.75
    });
    expect(merged.atrStop).toBeCloseTo(97, 4);
    expect(merged.stop).toBeCloseTo(97, 4);
    expect(merged.usedAtrFloor).toBe(true);
    expect((merged.structuralStop ?? 0) > (merged.stop ?? 0)).toBe(true);
  });

  test("preset k: dip tighter than breakout", () => {
    expect(referenceStopAtrK({ preset: "dip" })).toBe(0.75);
    expect(referenceStopAtrK({ preset: "breakout" })).toBe(1.25);
    expect(referenceStopAtrK({ tradingMode: "day" })).toBe(0.85);
    expect(referenceStopAtrK({ tradingMode: "swing" })).toBe(1);
  });
});
