import { describe, expect, test } from "vitest";
import { resolveScenarioVerdict } from "@/lib/scenario/scenario-verdict";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

function decision(overrides: Partial<TradeDecision> & Pick<TradeDecision, "state">): TradeDecision {
  return {
    line: "test",
    reinforcements: [],
    rationale: null,
    conviction: null,
    ...overrides
  };
}

describe("resolveScenarioVerdict — strict gates", () => {
  test("red when system decision is blocked", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({ state: "blocked" }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 115
    });
    expect(v.tone).toBe("red");
    expect(v.headline).toMatch(/do not recommend/i);
  });

  test("green only when actionable, desk R/R clears, and no blockers", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({ state: "actionable", reinforcements: [] }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 115
    });
    expect(v.tone).toBe("green");
    expect(v.clearsDeskRr).toBe(true);
  });

  test("amber when R/R clears but decision is monitor", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({
        state: "monitor",
        reinforcements: ["Layers don't agree enough across the desk."]
      }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 115
    });
    expect(v.tone).toBe("amber");
    expect(v.blockers.length).toBeGreaterThan(0);
  });

  test("red when actionable but scenario R/R below desk minimum", () => {
    const v = resolveScenarioVerdict({
      systemDecision: decision({
        state: "actionable",
        rationale: {
          category: "risk_reward",
          text: "The reward doesn't justify the risk at 1.3:1 (below our minimum). Not worth considering for scenario planning yet."
        },
        reinforcements: ["Risk/reward too low (1.3:1) — below swing desk threshold (2.0:1)."]
      }),
      mode: "swing",
      direction: "bullish",
      entry: 100,
      stop: 95,
      target: 102
    });
    expect(v.tone).toBe("red");
    expect(v.clearsDeskRr).toBe(false);
    expect(v.blockers.some((b) => /risk\/reward/i.test(b))).toBe(false);
  });
});
