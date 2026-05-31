import { describe, expect, test } from "vitest";
import { evaluatePresetRiskCap, riskPctOfEntry } from "@/lib/scenario/planning-risk-present";

describe("planning-risk-present", () => {
  test("riskPctOfEntry for long", () => {
    expect(riskPctOfEntry("bullish", 100, 98)).toBe(2);
  });

  test("evaluatePresetRiskCap warns when over dip cap", () => {
    const ev = evaluatePresetRiskCap("dip", 2.5);
    expect(ev?.withinCap).toBe(false);
    expect(ev?.message).toContain("1.5%");
  });
});
