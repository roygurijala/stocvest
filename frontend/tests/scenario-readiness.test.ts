import { describe, expect, test } from "vitest";

import {
  defaultMissingBullets,
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import type { ScenarioInput } from "@/lib/scenario/types";

function baseInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    symbol: "AAPL",
    direction: "bullish",
    mode: "day",
    generated_at: new Date().toISOString(),
    reference: { current_price: 100, stop: 95, target_1: 110 },
    volatility_regime: "normal",
    ...overrides
  };
}

function ctx(overrides: Partial<ScenarioReadinessContext> = {}): ScenarioReadinessContext {
  return {
    symbol: "AAPL",
    mode: "day",
    setupBias: "Bullish",
    ...overrides
  };
}

describe("resolveScenarioBuilderCapability", () => {
  test("preview when not actionable and low alignment", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 2, layersTotal: 6 }), baseInput());
    expect(r.capability).toBe("preview");
    expect(r.aligned).toBe(2);
    expect(r.total).toBe(6);
  });

  test("building_soon at 3/6 alignment without actionable state", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 3, layersTotal: 6 }), baseInput());
    expect(r.capability).toBe("building_soon");
  });

  test("preview below 3/6 when not developing", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 2, layersTotal: 6 }), baseInput());
    expect(r.capability).toBe("preview");
  });

  test("building_soon when maturation is developing", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ maturationState: "developing", layersAligned: 1 }),
      baseInput()
    );
    expect(r.capability).toBe("building_soon");
  });

  test("full only when actionable and structurally eligible", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable", layersAligned: 6, layersTotal: 6 }),
      baseInput()
    );
    expect(r.capability).toBe("full");
    expect(r.structurallyComplete).toBe(true);
  });

  test("preview when actionable but structurally incomplete", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable" }),
      baseInput({ reference: {}, volatility_regime: "unknown" })
    );
    expect(r.capability).not.toBe("full");
  });

  test("gap intel disabled forces preview not full", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable", layersAligned: 6, layersTotal: 6 }),
      baseInput({
        gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["closed"] }
      })
    );
    expect(r.capability).toBe("preview");
    expect(r.gapIntelBlocked).toBe(true);
  });

  test("directional label from bias without prices in resolved", () => {
    const r = resolveScenarioBuilderCapability(ctx({ setupBias: "Bearish" }), baseInput());
    expect(r.directionalLabel).toBe("Short bias");
  });
});

describe("defaultMissingBullets", () => {
  test("maps Internals to participation copy", () => {
    const resolved = resolveScenarioBuilderCapability(ctx(), baseInput());
    const bullets = defaultMissingBullets({
      ...resolved,
      missingLayers: ["Internals"]
    });
    expect(bullets[0]).toContain("Participation");
  });
});
