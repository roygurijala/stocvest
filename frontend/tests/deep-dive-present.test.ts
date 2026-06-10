import { describe, expect, test } from "vitest";
import {
  buildBriefAlignmentLine,
  buildEntryZoneRrWarning,
  buildRichBrief,
  resolveDeepDiveDirection,
  resolveDeepDiveVerdictLabel,
  resolveDeepDiveVerdictTone,
  resolveEntryZonePosition,
  scenarioPriceAxisPercent,
  scenarioTrackBounds
} from "@/lib/dashboard/trading-room/deep-dive-present";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

const bearishRows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bearish", score: 40, explanation: "" },
  { key: "sector", name: "Sector", status: "Bearish", score: 38, explanation: "" },
  { key: "internals", name: "Market Internals", status: "Bearish", score: 42, explanation: "" },
  { key: "news", name: "News", status: "Neutral", score: 50, explanation: "" },
  { key: "macro", name: "Macro", status: "Neutral", score: 48, explanation: "" },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", score: 50, explanation: "" }
];

describe("deep-dive-present", () => {
  test("resolveDeepDiveVerdictLabel uses live monitor when composite is neutral", () => {
    expect(resolveDeepDiveVerdictLabel("actionable", "monitor", true)).toBe("Monitor");
    expect(resolveDeepDiveVerdictTone("actionable", "monitor", true)).toBe("caution");
    expect(resolveDeepDiveVerdictLabel("actionable", null, false)).toBe("Actionable");
  });

  test("resolveDeepDiveDirection prefers composite setup bias", () => {
    expect(resolveDeepDiveDirection("Bearish", true, "bull")).toEqual({
      direction: "short",
      bannerLabel: "SHORT"
    });
    expect(resolveDeepDiveDirection("Neutral", true, "bear")).toEqual({
      direction: "neutral",
      bannerLabel: "NEUTRAL"
    });
    expect(resolveDeepDiveDirection("Bullish", false, "bear")).toEqual({
      direction: "short",
      bannerLabel: "SHORT"
    });
  });

  test("buildBriefAlignmentLine counts confirming layers only", () => {
    const line = buildBriefAlignmentLine("Bearish", bearishRows);
    expect(line).toContain("3 of 6 layers confirm the bearish thesis");
    expect(line).toContain("Technical, Sector, Market Internals");
    expect(line).toContain("neutral — not contradicting");
    expect(line).not.toContain("5 of 6");
  });

  test("buildRichBrief uses current R/R wording", () => {
    const text = buildRichBrief({
      symbol: "TEST",
      direction: "short",
      insight: null,
      layerRows: bearishRows,
      setupBias: "Bearish",
      pageDecisionState: "monitor",
      causalSummary: null,
      causalChainLabel: null,
      setupJudgment: {
        tradeability: { label: "Weak entry timing", flags: [] },
        primaryBlocker: null,
        watchFor: null
      },
      currentRr: 0.2,
      activeLane: "swing",
      deskMinRr: 2,
      verdictFallback: ""
    });
    expect(text).toContain("Risk/reward from current price is 0.2:1");
    expect(text).toContain("below the 2.0:1 threshold");
    expect(text).toContain("3 of 6 layers confirm the bearish thesis");
  });

  test("resolveEntryZonePosition detects above-zone price", () => {
    expect(resolveEntryZonePosition(35.73, 33.48, 34.15)).toBe("above");
    expect(resolveEntryZonePosition(34, 33.48, 34.15)).toBe("inside");
  });

  test("buildEntryZoneRrWarning surfaces chase risk", () => {
    const lines = buildEntryZoneRrWarning({
      position: "above",
      currentPrice: 35.73,
      entryLow: 33.48,
      entryHigh: 34.15,
      currentRr: 0.2,
      zoneEdgeRr: 2,
      chosenLabel: "T1",
      minRr: 2
    });
    expect(lines[0]).toContain("above the entry zone");
    expect(lines.some((l) => l.includes("0.2:1"))).toBe(true);
    expect(lines.some((l) => l.includes("2.0:1"))).toBe(true);
    expect(lines.at(-1)).toContain("Do not enter at current price");
  });

  test("scenarioTrackBounds and price axis percent handle short geometry", () => {
    const { trackMin, trackMax } = scenarioTrackBounds([51.66, 33.12, 35.73, 33.48, 34.15]);
    expect(trackMin).toBeCloseTo(33.12, 2);
    expect(trackMax).toBeCloseTo(51.66, 2);
    expect(scenarioPriceAxisPercent(33.12, trackMin, trackMax)).toBeCloseTo(0, 1);
    expect(scenarioPriceAxisPercent(51.66, trackMin, trackMax)).toBeCloseTo(100, 1);
    expect(scenarioPriceAxisPercent(35.73, trackMin, trackMax)).toBeGreaterThan(10);
    expect(scenarioPriceAxisPercent(35.73, trackMin, trackMax)).toBeLessThan(90);
  });
});
