import { describe, expect, it, beforeEach } from "vitest";
import { collectThesisTransitionAlerts } from "@/lib/trade-plan/report-tracked-plan-thesis-alerts";
import type { TrackedPlan } from "@/lib/trade-plan/types";

const plan = (): TrackedPlan => ({
  id: "swing:AAPL:1",
  symbol: "AAPL",
  mode: "swing",
  committedAt: "2026-06-10T14:00:00.000Z",
  bias: "Bullish",
  levels: {
    entryLow: 180,
    entryHigh: 185,
    stop: 170,
    target1: 200,
    priceAtCommit: 182
  }
});

describe("collectThesisTransitionAlerts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("bootstraps first observation without alerting", () => {
    const diff = new Map([
      [
        "swing:AAPL:1",
        {
          thesis: { status: "invalid" as const, label: "Thesis blocked", hint: "blocked" },
          trigger: { label: "Wait" }
        }
      ]
    ]);
    const alerts = collectThesisTransitionAlerts([plan()], diff);
    expect(alerts).toHaveLength(0);
    const again = collectThesisTransitionAlerts([plan()], diff);
    expect(again).toHaveLength(0);
  });

  it("alerts when thesis worsens after bootstrap", () => {
    const valid = new Map([
      [
        "swing:AAPL:1",
        {
          thesis: { status: "valid" as const, label: "Thesis intact", hint: "" },
          trigger: { label: "Wait" }
        }
      ]
    ]);
    collectThesisTransitionAlerts([plan()], valid);

    const invalid = new Map([
      [
        "swing:AAPL:1",
        {
          thesis: { status: "invalid" as const, label: "Thesis flipped", hint: "flipped" },
          trigger: { label: "Wait" }
        }
      ]
    ]);
    const alerts = collectThesisTransitionAlerts([plan()], invalid);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.thesisStatus).toBe("invalid");
    expect(alerts[0]?.previousStatus).toBe("valid");
  });
});
