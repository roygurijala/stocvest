import { describe, expect, it } from "vitest";
import {
  buildLiveAssessmentFromDeepDive,
  resolveLiveVsPlanDiff,
  resolveTriggerDisplay
} from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";

const plan: TrackedPlan = {
  id: "swing:TEST:1",
  symbol: "TEST",
  mode: "swing",
  committedAt: "2026-06-10T10:00:00.000Z",
  bias: "Bullish",
  layersAligned: 5,
  layersTotal: 6,
  levels: {
    entryLow: 100,
    entryHigh: 105,
    stop: 95,
    target1: 115,
    priceAtCommit: 102,
    riskRewardAtCommit: 2.5
  },
  deskMinRr: 2
};

describe("plan-status", () => {
  it("enter_now when execution actionable", () => {
    const live = buildLiveAssessmentFromDeepDive({
      currentPrice: 103,
      setupBias: "Bullish",
      decisionState: "actionable",
      executionActionable: true,
      entryLow: 100,
      entryHigh: 105,
      currentRr: 2.2,
      isInsufficient: false,
      layersAligned: 5,
      layersTotal: 6
    });
    const trigger = resolveTriggerDisplay(live, 2);
    expect(trigger.status).toBe("enter_now");
  });

  it("wait_for_entry when price outside zone", () => {
    const live = buildLiveAssessmentFromDeepDive({
      currentPrice: 110,
      setupBias: "Bullish",
      decisionState: "monitor",
      executionActionable: false,
      entryLow: 100,
      entryHigh: 105,
      currentRr: 0.8,
      isInsufficient: false
    });
    const trigger = resolveTriggerDisplay(live, 2);
    expect(trigger.status).toBe("wait_for_entry");
  });

  it("frozen plan lines stay stable while live read changes", () => {
    const live = buildLiveAssessmentFromDeepDive({
      currentPrice: 110,
      setupBias: "Bullish",
      decisionState: "monitor",
      executionActionable: false,
      entryLow: 100,
      entryHigh: 105,
      currentRr: 0.5,
      isInsufficient: false,
      layersAligned: 4,
      layersTotal: 6
    });
    const diff = resolveLiveVsPlanDiff(plan, live, 2);
    expect(diff.planLines.some((l) => l.includes("100.00"))).toBe(true);
    expect(diff.trigger.status).toBe("wait_for_entry");
    expect(diff.managementLines.length).toBeGreaterThan(0);
  });
});
