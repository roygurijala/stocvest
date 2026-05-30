import { describe, expect, test } from "vitest";
import {
  confirmationRationaleText,
  mergeRiskRewardGateLine,
  readinessRationaleText,
  riskRewardRationaleText,
  timeframeDivergenceReinforcement
} from "@/lib/signal-evidence/decision-copy";

describe("decision-copy", () => {
  test("readiness uses plain English", () => {
    expect(readinessRationaleText()).toContain("Not enough signals agree");
    expect(readinessRationaleText()).toContain("worth considering");
  });

  test("timeframe divergence caution copy", () => {
    expect(timeframeDivergenceReinforcement("swing")).toMatch(/short-term and longer-term trend/i);
    expect(timeframeDivergenceReinforcement("swing")).toContain("caution flag");
  });

  test("mergeRiskRewardGateLine combines desk threshold", () => {
    const merged = mergeRiskRewardGateLine(
      riskRewardRationaleText("0.5"),
      "Risk/reward too low (0.5:1) — below swing desk threshold (2.0:1)."
    );
    expect(merged).toMatch(/0\.5:1/);
    expect(merged.toLowerCase()).toContain("worth considering");
  });
});
