import { describe, expect, test } from "vitest";
import { resolveScenarioVerdict } from "@/lib/scenario/scenario-verdict";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

function decision(overrides: Partial<TradeDecision> & Pick<TradeDecision, "state">): TradeDecision {
  return {
    line: "test",
    reinforcements: [],
    rationale: null,
    ...overrides
  };
}

describe("resolveScenarioVerdict — execution timing cap", () => {
  test("never green when VWAP conflict even if actionable and R/R clears", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({
        state: "actionable",
        reinforcements: ["VWAP conflict"]
      }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 115,
      executionTiming: { vwapConflict: true }
    });
    expect(v.tone).toBe("amber");
    expect(v.blockers.some((b) => /vwap/i.test(b))).toBe(true);
  });

  test("never green when weak entry timing", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({
        state: "actionable",
        reinforcements: ["Weak entry timing"]
      }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 115,
      executionTiming: { entryTimingWeak: true }
    });
    expect(v.tone).not.toBe("green");
  });
});
