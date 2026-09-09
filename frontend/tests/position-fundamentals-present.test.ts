import { describe, expect, it } from "vitest";

import {
  parsePositionFundamentals,
  parsePositionThesisPacket
} from "@/lib/dashboard/trading-room/position-fundamentals-present";

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

describe("parsePositionThesisPacket", () => {
  it("parses bull/bear/open with source + confidence", () => {
    const packet = parsePositionThesisPacket({
      position_thesis_packet: {
        symbol: "AAPL",
        verdict: "bullish",
        bull_case: [{ text: "Strong F1", source: "F1", confidence: "high" }],
        bear_case: [{ text: "Watch F4", source: "F4", confidence: "medium" }],
        open_questions: [{ text: "Entry price?", source: "F4", confidence: "low" }],
        pillar_snapshot_hash: "abc123"
      }
    });
    expect(packet?.symbol).toBe("AAPL");
    expect(packet?.bullCase[0]).toEqual({ text: "Strong F1", source: "F1", confidence: "high" });
    expect(packet?.bearCase[0].source).toBe("F4");
    expect(packet?.openQuestions[0].confidence).toBe("low");
    expect(packet?.pillarSnapshotHash).toBe("abc123");
  });

  it("drops bullets with no text and defaults bad confidence to low", () => {
    const packet = parsePositionThesisPacket({
      position_thesis_packet: {
        symbol: "MSFT",
        verdict: "neutral",
        bull_case: [{ text: "", source: "F1", confidence: "high" }, { text: "ok", source: "F2", confidence: "weird" }],
        bear_case: [],
        open_questions: [],
        pillar_snapshot_hash: "h"
      }
    });
    expect(packet?.bullCase).toHaveLength(1);
    expect(packet?.bullCase[0].confidence).toBe("low");
  });

  it("returns null when packet missing or fully empty", () => {
    expect(parsePositionThesisPacket({})).toBeNull();
    expect(
      parsePositionThesisPacket({
        position_thesis_packet: { symbol: "X", verdict: "neutral", bull_case: [], bear_case: [], open_questions: [], pillar_snapshot_hash: "h" }
      })
    ).toBeNull();
  });
});
