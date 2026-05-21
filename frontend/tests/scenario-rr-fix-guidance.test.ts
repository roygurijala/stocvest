import { describe, expect, test } from "vitest";

import { buildScenarioRrFixGuidance } from "@/lib/scenario/scenario-rr-fix-guidance";
import { SCENARIO_RR_MIN } from "@/lib/scenario/scenario-variants";

describe("scenario-rr-fix-guidance", () => {
  test("bearish AMD-style scenario — target, stop, entry thresholds", () => {
    const g = buildScenarioRrFixGuidance(
      { entry: 440.88, stop: 448.9, target: 431.6, riskReward: 1.2 },
      "bearish"
    )!;
    expect(g.requiredReward).toBeCloseTo(16.04, 1);
    expect(g.targetExtensionGap).toBeCloseTo(6.76, 1);
    const targetLever = g.levers.find((l) => l.id === "target")!;
    expect(targetLever.thresholdText).toContain("424.84");
    expect(targetLever.calcLine).toBe("440.88 − 2.0 × 8.02");
    const stopLever = g.levers.find((l) => l.id === "stop")!;
    expect(stopLever.thresholdText).toMatch(/445\.5/);
    const entryLever = g.levers.find((l) => l.id === "entry")!;
    expect(entryLever.thresholdText).toMatch(/443\.1/);
    expect(g.levers[0].quality).toBe("best");
    expect(g.levers[g.levers.length - 1].quality).toBe("risky");
    expect(g.diagnosis).toMatch(/entry timing/i);
  });

  test("returns null when R:R already clears gate", () => {
    expect(
      buildScenarioRrFixGuidance(
        { entry: 301.2, stop: 297.48, target: 310, riskReward: SCENARIO_RR_MIN },
        "bullish"
      )
    ).toBeNull();
  });

  test("warns when required target exceeds reference T2", () => {
    const g = buildScenarioRrFixGuidance(
      { entry: 440.88, stop: 448.9, target: 431.6, riskReward: 1.2 },
      "bearish",
      { target1: 430, target2: 428, structuralStop: 449 }
    )!;
    expect(g.warnings.some((w) => /fantasy|realistic/i.test(w))).toBe(true);
  });
});
