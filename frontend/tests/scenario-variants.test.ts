import { describe, expect, test } from "vitest";

import {
  buildScenarioGeometryBundle,
  buildScenarioGeometrySource,
  buildScenarioVariantCatalog,
  isExecutionStageEligibleForScenarioAdjust,
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

  test("neutral bias yields no geometry bundle", () => {
    expect(
      buildScenarioGeometryBundle({
        bias: "Neutral",
        last: 301,
        maturationState: "developing",
        layersAligned: 3
      })
    ).toBeNull();
  });

  test("not_aligned stage hides panel", () => {
    expect(isExecutionStageEligibleForScenarioAdjust({ maturationState: "not_aligned", layersAligned: 0 })).toBe(
      false
    );
    expect(
      buildScenarioGeometryBundle({
        bias: "Bullish",
        last: 100,
        maturationState: "not_aligned",
        layersAligned: 0
      })
    ).toBeNull();
  });

  test("developing with last only yields estimated bundle", () => {
    const bundle = buildScenarioGeometryBundle({
      bias: "Bearish",
      last: 266.5,
      maturationState: "developing",
      layersAligned: 2,
      layersTotal: 6,
      support: 264,
      resistance: 268,
      systemRiskReward: 1.0
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.precision).toBe("estimated");
    expect(bundle!.estimationLines.length).toBeGreaterThan(0);
    expect(buildScenarioVariantCatalog(bundle!.source)).not.toBeNull();
  });

  test("validated when composite levels and zone provided", () => {
    const bundle = buildScenarioGeometryBundle({
      bias: "Bullish",
      last: 301.2,
      entryZoneLow: 299,
      entryZoneHigh: 302,
      structuralStop: 297.48,
      target1: 302.8,
      maturationState: "developing",
      layersAligned: 3,
      compositeStopProvided: true,
      compositeTargetProvided: true,
      compositeZoneProvided: true
    });
    expect(bundle?.precision).toBe("validated");
  });
});
