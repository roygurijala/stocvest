import { describe, expect, test } from "vitest";
import {
  MIN_POSITION_RR,
  POSITION_STOP_ATR_K,
  positionReferenceStopAtrK,
  resolvePositionMergedReferenceStop
} from "@/lib/scenario/position-reference-stop-resolve";

describe("position-reference-stop-resolve", () => {
  test("position ATR k is wider than swing default", () => {
    expect(positionReferenceStopAtrK()).toBe(3.0);
    expect(POSITION_STOP_ATR_K).toBeGreaterThan(2.0);
  });

  test("large-cap position stop meets min distance", () => {
    const merged = resolvePositionMergedReferenceStop({
      direction: "bullish",
      entry: 180,
      structuralStop: 172,
      atr: 8
    });
    expect(merged.stop).not.toBeNull();
    expect(180 - (merged.stop ?? 0)).toBeGreaterThanOrEqual(180 * 0.1 - 0.01);
    expect(merged.usedAtrFloor).toBe(true);
  });

  test("min position R/R default", () => {
    expect(MIN_POSITION_RR).toBe(1.5);
  });
});
