import { describe, expect, test } from "vitest";
import {
  referenceStopAtrK,
  resolveMergedReferenceStop,
  resolveStructuralStopAnchor
} from "@/lib/scenario/reference-stop-resolve";

describe("reference-stop-resolve", () => {
  test("structural long anchor matches session low + VWAP buffer", () => {
    const structural = resolveStructuralStopAnchor({
      direction: "bullish",
      sessionLow: 98,
      sessionHigh: 102,
      vwap: 99.5,
      prevClose: 99,
      last: 100
    });
    expect(structural).toBeCloseTo(Math.round(98 * 0.998 * 10000) / 10000, 4);
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
