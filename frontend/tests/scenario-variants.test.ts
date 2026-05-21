import { describe, expect, test } from "vitest";

import {
  buildScenarioGeometrySource,
  buildScenarioVariantCatalog,
  remainingBlockersAfterScenarioRr,
  resolveScenarioLevels,
  scenarioClearsRrGate,
  SCENARIO_RR_MIN
} from "@/lib/scenario/scenario-variants";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

describe("scenario-variants", () => {
  const bullishSource = buildScenarioGeometrySource({
    bias: "Bullish",
    entryZoneLow: 299,
    entryZoneHigh: 302,
    last: 301.2,
    structuralStop: 297.48,
    target1: 302.8,
    target2: 306.5,
    vwap: 300.5,
    systemRiskReward: 0.5
  })!;

  test("default preset matches structural mid entry", () => {
    const catalog = buildScenarioVariantCatalog(bullishSource)!;
    expect(catalog.system?.riskReward).toBeGreaterThan(0);
    const aggressive = resolveScenarioLevels(bullishSource, catalog.presets.aggressive)!;
    const conservative = resolveScenarioLevels(bullishSource, catalog.presets.conservative)!;
    expect(aggressive.riskReward).toBeGreaterThan(conservative.riskReward);
  });

  test("aggressive + tight + t2 can clear R/R gate when system cannot", () => {
    const catalog = buildScenarioVariantCatalog(bullishSource)!;
    const tuned = resolveScenarioLevels(bullishSource, catalog.presets.aggressive)!;
    expect(tuned.riskReward).toBeGreaterThanOrEqual(SCENARIO_RR_MIN);
    expect(scenarioClearsRrGate(tuned.riskReward)).toBe(true);
    expect(scenarioClearsRrGate(bullishSource.systemRiskReward!)).toBe(false);
  });

  test("remainingBlockersAfterScenarioRr drops R/R-only lines when scenario clears", () => {
    const decision: TradeDecision = {
      state: "monitor",
      line: "Held",
      reinforcements: ["Risk/reward too low (0.5:1) — below threshold.", "Layer agreement is mixed."],
      rationale: {
        category: "risk_reward",
        label: "Why hold:",
        text: "Risk/reward too low (0.5:1) — below threshold."
      }
    };
    const blocked = remainingBlockersAfterScenarioRr(decision, false);
    expect(blocked.some((l) => /risk\/reward/i.test(l))).toBe(true);
    const after = remainingBlockersAfterScenarioRr(decision, true);
    expect(after.some((l) => /risk\/reward/i.test(l))).toBe(false);
    expect(after.some((l) => /Layer agreement/i.test(l))).toBe(true);
  });

  test("neutral bias yields no geometry source", () => {
    expect(
      buildScenarioGeometrySource({
        bias: "Neutral",
        structuralStop: 1,
        target1: 2,
        last: 1.5
      })
    ).toBeNull();
  });
});
