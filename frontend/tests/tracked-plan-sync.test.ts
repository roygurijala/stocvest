import { describe, expect, it } from "vitest";
import { mergeTrackedPlans } from "@/lib/trade-plan/tracked-plan-merge";
import type { TrackedPlan } from "@/lib/trade-plan/types";
import { assessTrackedPlanFromComposite } from "@/lib/trade-plan/assess-tracked-plan-live";

const basePlan = (): TrackedPlan => ({
  id: "swing:AAPL:1",
  symbol: "AAPL",
  mode: "swing",
  committedAt: "2026-06-10T14:00:00.000Z",
  bias: "Bullish",
  layersAligned: 5,
  layersTotal: 6,
  levels: {
    entryLow: 180,
    entryHigh: 185,
    stop: 170,
    target1: 200,
    priceAtCommit: 182
  }
});

describe("tracked-plan-merge", () => {
  it("keeps newest commit per symbol+mode", () => {
    const older = { ...basePlan(), id: "swing:AAPL:1", committedAt: "2026-06-09T14:00:00.000Z" };
    const newer = {
      ...basePlan(),
      id: "swing:AAPL:2",
      committedAt: "2026-06-11T14:00:00.000Z",
      levels: { ...basePlan().levels, stop: 168 }
    };
    const merged = mergeTrackedPlans([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("swing:AAPL:2");
    expect(merged[0]?.levels.stop).toBe(168);
  });
});

describe("assess-tracked-plan-live", () => {
  it("marks thesis unavailable when composite is missing", () => {
    const diff = assessTrackedPlanFromComposite(basePlan(), null);
    expect(diff.thesis.status).toBe("invalid");
    expect(diff.thesis.label).toBe("Thesis unavailable");
  });
});
