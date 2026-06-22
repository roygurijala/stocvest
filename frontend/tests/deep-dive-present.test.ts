import { describe, expect, test } from "vitest";
import {
  buildBriefAlignmentLine,
  buildEntryZoneRrWarning,
  buildRichBrief,
  resolveDeepDiveDirection,
  resolveDeepDiveVerdictLabel,
  resolveDeepDiveVerdictTone,
  resolveEntryZonePosition,
  scenarioGeometryIsShort,
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

  test("buildRichBrief threads named signals, regime, and catalyst", () => {
    const insight = {
      signal_score: 78,
      trend_strength: "Strong",
      trend_direction: "Bullish",
      risk_reward: 2.4,
      market_regime: "risk-on",
      confirming_signals: [{ label: "Breakout over 50-day high" }, { label: "RSI rising" }],
      conflicting_signals: [{ label: "VIX elevated" }],
      catalysts: [{ text: "Beats Q3 earnings expectations", sentiment: "bullish" }],
      risk_factors: [],
      signal_parameters: "",
      historical_entry_zone: null,
      reference_target_1: null,
      reference_target_2: null,
      reference_stop_level: null
    } as unknown as Parameters<typeof buildRichBrief>[0]["insight"];

    const text = buildRichBrief({
      symbol: "NVDA",
      direction: "long",
      insight,
      layerRows: bearishRows,
      setupBias: "Bullish",
      pageDecisionState: "actionable",
      causalSummary: null,
      causalChainLabel: null,
      setupJudgment: {
        tradeability: { label: "Strong entry timing", flags: [] },
        primaryBlocker: null,
        watchFor: null
      },
      currentRr: 2.4,
      activeLane: "swing",
      deskMinRr: 2,
      verdictFallback: ""
    });
    expect(text).toContain("led by Breakout over 50-day high");
    expect(text).toContain("VIX elevated");
    expect(text).toContain("risk-on tape");
    expect(text).toContain("News in play: Beats Q3 earnings expectations (bullish catalyst)");
  });

  test("buildRichBrief opener varies by symbol but is stable per symbol", () => {
    const base = {
      direction: "neutral" as const,
      insight: null,
      layerRows: bearishRows,
      setupBias: "Neutral" as const,
      pageDecisionState: "monitor",
      causalSummary: "Sector is the local gate still open.",
      causalChainLabel: null,
      setupJudgment: {
        tradeability: { label: "Neutral", flags: [] },
        primaryBlocker: null,
        watchFor: null
      },
      currentRr: null,
      activeLane: "swing" as const,
      deskMinRr: 2,
      verdictFallback: ""
    };
    const openerOf = (text: string) => text.split(". ")[0];
    const a1 = openerOf(buildRichBrief({ ...base, symbol: "AAPL" }));
    const a2 = openerOf(buildRichBrief({ ...base, symbol: "AAPL" }));
    const tsla = openerOf(buildRichBrief({ ...base, symbol: "TSLA" }));
    const intc = openerOf(buildRichBrief({ ...base, symbol: "INTC" }));
    expect(a1).toBe(a2); // stable per symbol
    // At least one of the other symbols reads differently from AAPL.
    expect(tsla !== a1 || intc !== a1).toBe(true);
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

  describe("scenarioGeometryIsShort", () => {
    test("valid long geometry (stop below target) orients long, matching bias", () => {
      expect(scenarioGeometryIsShort(95, 110, false)).toBe(false);
    });

    test("valid short geometry (stop above target) orients short, matching bias", () => {
      expect(scenarioGeometryIsShort(120, 105, true)).toBe(true);
    });

    test("inverted geometry overrides the bias so labels follow the value axis", () => {
      // Bullish bias but stop ($215.06) is above target ($208.45): the bar must render
      // short so the current marker (≈ target) sits beside its Target label, not mid-bar.
      expect(scenarioGeometryIsShort(215.06, 208.45, false)).toBe(true);
      // Bearish bias but stop below target: render long.
      expect(scenarioGeometryIsShort(95, 110, true)).toBe(false);
    });

    test("falls back to the supplied bias when stop and target coincide or are non-finite", () => {
      expect(scenarioGeometryIsShort(100, 100, true)).toBe(true);
      expect(scenarioGeometryIsShort(100, 100, false)).toBe(false);
      expect(scenarioGeometryIsShort(Number.NaN, 100, true)).toBe(true);
      expect(scenarioGeometryIsShort(100, Number.NaN, false)).toBe(false);
    });
  });
});
