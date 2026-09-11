import { describe, expect, it } from "vitest";

import {
  buildPositionThesisSummary,
  parsePositionFundamentals,
  parsePositionHolderRead,
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
    expect(packet?.fundamentalsCovered).toBe(true);
  });

  it("marks fundamentals not covered when the server flag is false", () => {
    const packet = parsePositionThesisPacket({
      position_thesis_packet: {
        symbol: "ZZZ",
        verdict: "bullish",
        bull_case: [],
        bear_case: [],
        open_questions: [{ text: "Insufficient fundamentals coverage.", source: "layer:fundamentals", confidence: "low" }],
        pillar_snapshot_hash: "nohash",
        fundamentals_covered: false
      }
    });
    expect(packet?.fundamentalsCovered).toBe(false);
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

describe("buildPositionThesisSummary (POS-AI-3)", () => {
  it("condenses bull/bear/open into one bounded line (top 2/2/1)", () => {
    const packet = parsePositionThesisPacket({
      position_thesis_packet: {
        symbol: "AAPL",
        verdict: "bullish",
        bull_case: [
          { text: "Strong ROIC", source: "F1", confidence: "high" },
          { text: "Low leverage", source: "F3", confidence: "high" },
          { text: "Third ignored", source: "F2", confidence: "low" }
        ],
        bear_case: [{ text: "Rich multiple", source: "F4", confidence: "medium" }],
        open_questions: [{ text: "Margin durability?", source: "F1", confidence: "low" }],
        pillar_snapshot_hash: "abc"
      }
    });
    expect(buildPositionThesisSummary(packet)).toBe(
      "Bull: Strong ROIC; Low leverage | Bear: Rich multiple | Open: Margin durability?"
    );
  });

  it("omits empty sections and returns empty string for null", () => {
    const packet = parsePositionThesisPacket({
      position_thesis_packet: {
        symbol: "MSFT",
        verdict: "neutral",
        bull_case: [{ text: "Only a bull point", source: "F1", confidence: "high" }],
        bear_case: [],
        open_questions: [],
        pillar_snapshot_hash: "h"
      }
    });
    expect(buildPositionThesisSummary(packet)).toBe("Bull: Only a bull point");
    expect(buildPositionThesisSummary(null)).toBe("");
  });
});

describe("parsePositionHolderRead (ship-dark)", () => {
  it("parses a well-formed holder read", () => {
    const read = parsePositionHolderRead({
      position_holder_read: {
        stance: "defensive",
        headline: "Structure has broken and reward-to-risk is unfavorable.",
        actions: ["Tighten your stop toward the weekly trend.", "Consider reducing exposure."],
        context: ["Reward-to-risk is 0.40 vs the desk minimum of 1.50 at this price."],
        disclaimer: "Informational position context — not personalized investment advice."
      }
    });
    expect(read).not.toBeNull();
    expect(read?.stance).toBe("defensive");
    expect(read?.actions).toHaveLength(2);
    expect(read?.context[0]).toContain("0.40");
  });

  it("returns null when absent (flag off), malformed, or has no actions", () => {
    expect(parsePositionHolderRead({})).toBeNull();
    expect(parsePositionHolderRead({ position_holder_read: { stance: "bogus", actions: ["x"] } })).toBeNull();
    expect(
      parsePositionHolderRead({ position_holder_read: { stance: "caution", actions: [] } })
    ).toBeNull();
  });
});
