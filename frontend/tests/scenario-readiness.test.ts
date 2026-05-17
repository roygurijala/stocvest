import { describe, expect, test } from "vitest";

import {
  resolveScenarioBuilderCapability,
  scenarioWhyNotItems,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import { nextUnlockBullets, setupTierLabel } from "@/lib/scenario/scenario-readiness-present";
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
  test("2/6 is developing not not aligned", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 2, layersTotal: 6 }), baseInput());
    expect(r.setupTier).toBe("developing");
    expect(setupTierLabel(r.setupTier, r.aligned, r.total)).toBe("Developing (2 / 6)");
    expect(r.capability).toBe("building_soon");
  });

  test("1/6 is not aligned", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 1, layersTotal: 6 }), baseInput());
    expect(r.setupTier).toBe("not_aligned");
    expect(r.capability).toBe("preview");
  });

  test("building_soon at 3/6 alignment without actionable state", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 3, layersTotal: 6 }), baseInput());
    expect(r.capability).toBe("building_soon");
    expect(r.setupTier).toBe("developing");
  });

  test("building_soon when maturation is developing", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ maturationState: "developing", layersAligned: 1 }),
      baseInput()
    );
    expect(r.capability).toBe("building_soon");
    expect(r.setupTier).toBe("developing");
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

  test("gap intel disabled blocks full but keeps developing setup tier", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable", layersAligned: 6, layersTotal: 6 }),
      baseInput({
        gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["closed"] }
      })
    );
    expect(r.capability).toBe("building_soon");
    expect(r.gapIntelBlocked).toBe(true);
    expect(r.setupTier).toBe("actionable");
    expect(r.executionTier).toBe("session_limited");
  });

  test("4/6 with gap blocked shows developing + session_limited", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 4, layersTotal: 6, maturationState: "developing" }),
      baseInput({
        gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["market_closed"] }
      })
    );
    expect(r.setupTier).toBe("developing");
    expect(r.executionTier).toBe("session_limited");
    expect(r.capability).toBe("building_soon");
  });

  test("directional label from bias without prices in resolved", () => {
    const r = resolveScenarioBuilderCapability(ctx({ setupBias: "Bearish" }), baseInput());
    expect(r.directionalLabel).toBe("Short bias");
  });
});

describe("scenarioWhyNotItems", () => {
  test("groups missing confirmation layer names", () => {
    const resolved = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 2, layersTotal: 6, layerRows: undefined }),
      baseInput()
    );
    const withMissing = {
      ...resolved,
      missingLayers: ["News", "Macro", "Geopolitical"]
    };
    const items = scenarioWhyNotItems(withMissing);
    expect(items[0]).toEqual({
      kind: "missing_confirmations",
      layers: ["News", "Macro", "Geopolitical"]
    });
  });
});

describe("nextUnlockBullets", () => {
  test("mentions alignment band and missing layer names", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 2, layersTotal: 6 }),
      baseInput()
    );
    const withMissing = { ...r, missingLayers: ["News", "Macro"] };
    const bullets = nextUnlockBullets(withMissing);
    expect(bullets.some((b) => b.includes("4–5 layers"))).toBe(true);
    expect(bullets.some((b) => b.includes("News, Macro"))).toBe(true);
  });
});
