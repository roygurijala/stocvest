import { describe, expect, test } from "vitest";

import {
  buildScenarioGeometryBundle,
  buildScenarioGeometrySource,
  buildScenarioVariantCatalog,
  buildScenarioRrImprovementGuidance,
  formatScenarioRrQuickCalc,
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

  test("continuation preset matches structural mid entry", () => {
    const catalog = buildScenarioVariantCatalog(bullishSource)!;
    expect(catalog.system?.riskReward).toBeGreaterThan(0);
    const dip = resolveScenarioLevels(bullishSource, catalog.presets.dip)!;
    const breakout = resolveScenarioLevels(bullishSource, catalog.presets.breakout)!;
    expect(dip.entry).toBeLessThanOrEqual(breakout.entry);
  });

  test("breakout entry above zone still resolves with T2 target", () => {
    const src = buildScenarioGeometrySource({
      bias: "Bullish",
      entryZoneLow: 440,
      entryZoneHigh: 447,
      last: 442,
      structuralStop: 430.74,
      target1: 445,
      target2: 465,
      vwap: 441,
      systemRiskReward: 0.5
    })!;
    const breakout = resolveScenarioLevels(src, {
      preset: "breakout",
      entry: "breakout",
      stop: "structural",
      target: "t2"
    });
    expect(breakout).not.toBeNull();
    expect(breakout!.entry).toBeGreaterThan(447);
    expect(breakout!.riskReward).toBeGreaterThan(0);
  });

  test("dip preset can clear R/R gate when system cannot", () => {
    const catalog = buildScenarioVariantCatalog(bullishSource)!;
    const tuned = resolveScenarioLevels(bullishSource, catalog.presets.dip)!;
    expect(tuned.riskReward).toBeGreaterThanOrEqual(SCENARIO_RR_MIN);
    expect(scenarioClearsRrGate(tuned.riskReward)).toBe(true);
    expect(scenarioClearsRrGate(bullishSource.systemRiskReward!)).toBe(false);
  });

  test("buildScenarioRrImprovementGuidance — bearish minimum target", () => {
    const g = buildScenarioRrImprovementGuidance(440.88, 448.9, "bearish")!;
    expect(g.requiredTarget).toBeCloseTo(424.84, 2);
    expect(g.riskPerShare).toBeCloseTo(8.02, 2);
    expect(formatScenarioRrQuickCalc(g)).toBe("440.88 − 2.0 × 8.02");
  });

  test("buildScenarioRrImprovementGuidance — bullish minimum target", () => {
    const g = buildScenarioRrImprovementGuidance(301.2, 297.48, "bullish")!;
    expect(g.requiredTarget).toBeGreaterThan(301.2);
    expect(formatScenarioRrQuickCalc(g)).toMatch(/301\.20 \+ 2\.0 ×/);
  });

  test("remainingBlockersAfterScenarioRr drops R/R lines from blockers list", () => {
    const decision: TradeDecision = {
      state: "monitor",
      line: "Held",
      reinforcements: [
        "Risk/reward is too low (0.5:1) for this desk's minimum.",
        "Layers don't agree enough across the desk."
      ],
      rationale: {
        category: "risk_reward",
        label: "Why hold:",
        text: "Risk/reward too low (0.5:1) — below threshold."
      }
    };
    const blocked = remainingBlockersAfterScenarioRr(decision, false);
    expect(blocked.some((l) => /risk\/reward/i.test(l))).toBe(false);
    expect(blocked.some((l) => /don't agree/i.test(l))).toBe(true);
    const after = remainingBlockersAfterScenarioRr(decision, true);
    expect(after.some((l) => /risk\/reward/i.test(l))).toBe(false);
    expect(after.some((l) => /don't agree/i.test(l))).toBe(true);
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
