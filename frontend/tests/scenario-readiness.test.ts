import { describe, expect, test } from "vitest";

import {
  resolveScenarioBuilderCapability,
  scenarioWhyNotItems,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import {
  nextUnlockBullets,
  scenarioPreviewTakeaway,
  setupTierLabel
} from "@/lib/scenario/scenario-readiness-present";
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
    expect(r.capability).toBe("full");
  });

  test("1/6 is not aligned but still opens full sheet when levels exist", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 1, layersTotal: 6 }), baseInput());
    expect(r.setupTier).toBe("not_aligned");
    expect(r.capability).toBe("full");
  });

  test("developing alignment opens full sheet when stop and target exist", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 3, layersTotal: 6 }), baseInput());
    expect(r.capability).toBe("full");
    expect(r.setupTier).toBe("developing");
  });

  test("developing maturation opens full sheet when structurally eligible", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ maturationState: "developing", layersAligned: 1 }),
      baseInput()
    );
    expect(r.capability).toBe("full");
    expect(r.setupTier).toBe("developing");
  });

  test("full when structurally eligible regardless of actionable state", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable", layersAligned: 6, layersTotal: 6 }),
      baseInput()
    );
    expect(r.capability).toBe("full");
    expect(r.structurallyComplete).toBe(true);
  });

  test("preview when reference stop or target missing", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable" }),
      baseInput({ reference: { current_price: 100 }, volatility_regime: "unknown" })
    );
    expect(r.capability).toBe("preview");
  });

  test("gap intel disabled opens full sheet with session_limited execution", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ decisionState: "actionable", layersAligned: 6, layersTotal: 6 }),
      baseInput({
        gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["closed"] }
      })
    );
    expect(r.capability).toBe("full");
    expect(r.gapIntelBlocked).toBe(true);
    expect(r.setupTier).toBe("actionable");
    expect(r.executionTier).toBe("session_limited");
  });

  test("4/6 with gap blocked shows near_ready + session_limited full sheet", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 4, layersTotal: 6, maturationState: "developing" }),
      baseInput({
        gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["market_closed"] }
      })
    );
    expect(r.setupTier).toBe("near_ready");
    expect(setupTierLabel(r.setupTier, r.aligned, r.total)).toBe("Near ready (4/6)");
    expect(r.executionTier).toBe("session_limited");
    expect(r.capability).toBe("full");
  });

  test("near_ready takeaway mentions actionable threshold", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 4, layersTotal: 6 }), baseInput());
    expect(r.setupTier).toBe("near_ready");
    expect(scenarioPreviewTakeaway(r).toLowerCase()).toContain("actionable");
  });

  test("near_ready unlock bullets use threshold language", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 4, layersTotal: 6, setupBias: "Bullish" }),
      baseInput()
    );
    const withMissing = { ...r, missingLayers: ["News", "Macro"] };
    const bullets = nextUnlockBullets(withMissing);
    expect(bullets.some((b) => b.includes("actionable threshold"))).toBe(true);
    expect(bullets.some((b) => b.includes("confirmations away"))).toBe(false);
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
  test("at 4/6 near_ready lists missing layers with threshold language", () => {
    const r = resolveScenarioBuilderCapability(
      ctx({ layersAligned: 4, layersTotal: 6, setupBias: "Bullish" }),
      baseInput()
    );
    const withMissing = { ...r, setupTier: "near_ready" as const, aligned: 4, missingLayers: ["News", "Macro", "Geopolitical"] };
    const bullets = nextUnlockBullets(withMissing);
    expect(bullets.some((b) => b.includes("actionable threshold"))).toBe(true);
    expect(bullets.some((b) => b.includes("News, Macro, Geopolitical"))).toBe(true);
    expect(bullets.some((b) => b.includes("4–5"))).toBe(false);
  });

  test("mentions execution window when session limited", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 4, layersTotal: 6 }), baseInput());
    const limited = { ...r, executionTier: "session_limited" as const, gapIntelBlocked: true };
    const bullets = nextUnlockBullets(limited);
    expect(bullets.some((b) => b.toLowerCase().includes("execution window"))).toBe(true);
  });
});

describe("scenarioPreviewTakeaway", () => {
  test("progressing setup with blocked execution", () => {
    const r = resolveScenarioBuilderCapability(ctx({ layersAligned: 4, layersTotal: 6 }), {
      ...baseInput(),
      gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["market_closed"] }
    });
    const line = scenarioPreviewTakeaway(r);
    expect(line.toLowerCase()).toContain("execution");
    expect(line.toLowerCase()).toMatch(/waits on session|not possible|not available/);
  });
});
