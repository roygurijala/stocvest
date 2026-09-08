import { describe, expect, it } from "vitest";

import { parsePositionFundamentals } from "@/lib/dashboard/trading-room/position-fundamentals-present";

describe("position-fundamentals-present", () => {
  it("parses pillar grid from composite body", () => {
    const body = {
      position_fundamentals: {
        status: "available",
        score: 72,
        verdict: "bullish",
        reasoning: "Solid profitability and balance sheet.",
        weakest_pillar_id: "F4",
        pillars: [
          {
            pillar_id: "F1",
            label: "Profitability & quality",
            score: 80,
            verdict: "bullish",
            status: "available",
            reasoning: "Strong margins",
            chips: ["ROE strong"],
            data_quality: "full"
          },
          {
            pillar_id: "F4",
            label: "Valuation",
            score: 42,
            verdict: "neutral",
            status: "available",
            reasoning: "Rich vs peers",
            chips: [],
            data_quality: "full"
          }
        ]
      }
    };
    const parsed = parsePositionFundamentals(body);
    expect(parsed?.score).toBe(72);
    expect(parsed?.weakestPillarId).toBe("F4");
    expect(parsed?.pillars).toHaveLength(2);
  });
});
