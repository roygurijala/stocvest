import { describe, expect, it, beforeEach } from "vitest";
import {
  exportTrackedPlansJson,
  getTrackedPlan,
  importTrackedPlansJson,
  listTrackedPlans,
  removeTrackedPlanForSymbol,
  saveTrackedPlan
} from "@/lib/trade-plan/tracked-plan-store";
import type { TrackedPlan } from "@/lib/trade-plan/types";

const samplePlan = (): TrackedPlan => ({
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
    priceAtCommit: 182,
    riskRewardAtCommit: 2.1
  }
});

describe("tracked-plan-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and retrieves plan by symbol and mode", () => {
    saveTrackedPlan(samplePlan());
    const found = getTrackedPlan("AAPL", "swing");
    expect(found?.levels.stop).toBe(170);
  });

  it("replaces prior plan for same symbol/mode", () => {
    saveTrackedPlan(samplePlan());
    const updated = { ...samplePlan(), id: "swing:AAPL:2", levels: { ...samplePlan().levels, stop: 168 } };
    saveTrackedPlan(updated);
    expect(getTrackedPlan("AAPL", "swing")?.levels.stop).toBe(168);
    expect(listTrackedPlans().length).toBe(1);
  });

  it("removes plan for symbol", () => {
    saveTrackedPlan(samplePlan());
    removeTrackedPlanForSymbol("AAPL", "swing");
    expect(getTrackedPlan("AAPL", "swing")).toBeNull();
  });

  it("exports and imports plans as JSON", () => {
    saveTrackedPlan(samplePlan());
    const json = exportTrackedPlansJson();
    localStorage.clear();
    const result = importTrackedPlansJson(json);
    expect(result.error).toBeUndefined();
    expect(result.imported).toBe(1);
    expect(getTrackedPlan("AAPL", "swing")?.levels.stop).toBe(170);
  });
});
