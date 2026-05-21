import { describe, expect, test } from "vitest";

import {
  MIN_RR_A_TIER,
  MIN_RR_VERDICT_DAY,
  MIN_RR_VERDICT_SWING,
  parseRiskRewardFromReadiness,
  resolveTradeConvictionTier
} from "@/lib/trade-conviction-tier";

describe("trade-conviction-tier", () => {
  test("A+ when actionable with R/R >= 2 and 5/6 alignment", () => {
    const t = resolveTradeConvictionTier({
      mode: "swing",
      riskReward: 2.4,
      layersAligned: 5,
      layersTotal: 6,
      decisionState: "actionable"
    });
    expect(t.tier).toBe("a_plus");
    expect(t.isDefaultRecommendation).toBe(true);
    expect(t.label).toMatch(/High conviction/i);
  });

  test("B+ when strong alignment and R/R in discretionary band", () => {
    const t = resolveTradeConvictionTier({
      mode: "swing",
      riskReward: 1.6,
      layersAligned: 5,
      layersTotal: 6,
      decisionState: "monitor"
    });
    expect(t.tier).toBe("b_plus");
    expect(t.isDefaultRecommendation).toBe(false);
    expect(t.detailLine).toMatch(/not STOCVEST's default recommendation/i);
    expect(t.scenarioBuilderNote).toMatch(/2\.0 : 1 on reference levels/);
  });

  test("day desk clears verdict at 1.4 but stays B+ below A-tier 2.0", () => {
    const t = resolveTradeConvictionTier({
      mode: "day",
      riskReward: 1.4,
      layersAligned: 5,
      layersTotal: 6,
      decisionState: "actionable"
    });
    expect(t.tier).toBe("b_plus");
    expect(t.summaryLine).toMatch(/below the 2\.0 : 1 A-tier/i);
  });

  test("developing when R/R below 1.3", () => {
    const t = resolveTradeConvictionTier({
      mode: "swing",
      riskReward: 1.1,
      layersAligned: 5,
      layersTotal: 6,
      decisionState: "monitor"
    });
    expect(t.tier).toBe("developing");
  });

  test("developing when regime conflict blocks B+", () => {
    const t = resolveTradeConvictionTier({
      mode: "swing",
      riskReward: 1.7,
      layersAligned: 5,
      layersTotal: 6,
      decisionState: "monitor",
      regimeConflict: true
    });
    expect(t.tier).toBe("developing");
  });

  test("parseRiskRewardFromReadiness", () => {
    expect(parseRiskRewardFromReadiness("Risk/reward too low (1.2:1) — below threshold.")).toBeCloseTo(1.2, 2);
  });

  test("threshold constants", () => {
    expect(MIN_RR_VERDICT_SWING).toBe(2);
    expect(MIN_RR_VERDICT_DAY).toBe(1.3);
    expect(MIN_RR_A_TIER).toBe(2);
  });
});
