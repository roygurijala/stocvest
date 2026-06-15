import { describe, expect, test } from "vitest";
import { roundRiskRewardDisplay, structureRiskRewardLong } from "@/lib/risk-reward-structure";

describe("risk-reward-structure", () => {
  test("does not floor sub-0.5 values to 0.5", () => {
    expect(roundRiskRewardDisplay(0.35)).toBe(0.3);
    expect(roundRiskRewardDisplay(0.91)).toBe(0.9);
    expect(roundRiskRewardDisplay(0.12)).not.toBe(0.5);
  });

  test("uses resistance-anchored T2 when T1 R/R is below 1:1", () => {
    const stop = Math.round(Math.min(98, 99.5) * 0.998 * 10000) / 10000;
    const entry = 100;
    const t1 = 102;
    const t2 = entry + 2 * (entry - stop);
    const rr = structureRiskRewardLong(entry, t1, stop, t2, "resistance");
    expect(rr).not.toBeNull();
    expect(rr!).toBeGreaterThan(1);
    expect(roundRiskRewardDisplay(rr!)).not.toBe(0.5);
  });

  test("does not promote unanchored T2 when T1 is sub-1:1", () => {
    const stop = Math.round(Math.min(98, 99.5) * 0.998 * 10000) / 10000;
    const entry = 100;
    const t1 = 102;
    const t2 = entry + 2 * (entry - stop);
    const rr = structureRiskRewardLong(entry, t1, stop, t2, "2r_extension");
    expect(rr).toBeNull();
  });
});
