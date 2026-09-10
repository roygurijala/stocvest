import { describe, expect, test } from "vitest";

import {
  buildLayerAlignmentLine,
  buildLayerDrivers,
  buildLayerScoreRationale,
  filterDisplayChips,
  indicatorHighlights,
  layerDataConfidenceTier
} from "@/lib/signals/layer-drawer-present";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

function newsLayer(overrides: Partial<SignalsLayerRowInput> = {}): SignalsLayerRowInput {
  return {
    key: "news",
    name: "News",
    status: "Bullish",
    explanation: "News score 100/100 from 2 quality articles.",
    score: 100,
    chips: ["2 articles", "sent_avg +1.00", "Catalyst: earnings", "WIM context"],
    catalystArticles: [{ text: "Headline A", sentiment: "positive" }],
    ...overrides
  };
}

describe("layer-drawer-present", () => {
  test("buildLayerScoreRationale explains score vs verdict band", () => {
    const base: SignalsLayerRowInput = {
      key: "sector",
      name: "Sector",
      status: "Neutral",
      explanation: "",
      score: 62,
      bullishThreshold: 65,
      bearishThreshold: 35
    };
    // Inside neutral band.
    expect(buildLayerScoreRationale(base)).toMatch(/neutral band \(35–65\)/);
    // Clears bullish cutoff.
    expect(buildLayerScoreRationale({ ...base, score: 70 })).toMatch(/clears its ≥65 bullish cutoff/);
    // At/below bearish cutoff.
    expect(buildLayerScoreRationale({ ...base, score: 30 })).toMatch(/≤35 bearish cutoff/);
    // No thresholds falls back to status framing.
    expect(
      buildLayerScoreRationale({ key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 58 })
    ).toMatch(/reads bullish at 58\/100/);
    // Unavailable score.
    expect(
      buildLayerScoreRationale({ key: "macro", name: "Macro", status: "Unavailable", explanation: "", score: null })
    ).toMatch(/No live score/);
    // Missing score without unavailable status → null.
    expect(
      buildLayerScoreRationale({ key: "macro", name: "Macro", status: "Neutral", explanation: "", score: null })
    ).toBeNull();
  });

  test("filterDisplayChips removes stats duplicated by headline list", () => {
    const chips = filterDisplayChips(newsLayer());
    expect(chips).not.toContain("2 articles");
    expect(chips).not.toContain("sent_avg +1.00");
    expect(chips).not.toContain("Catalyst: earnings");
    expect(chips).toContain("WIM context");
  });

  test("indicatorHighlights caps and skips noise fields", () => {
    const rows = indicatorHighlights({
      mode: "day",
      rsi: 58,
      ema9: 12.5,
      bars_analyzed: 120,
      orb_qualified: false,
      volume_vs_adv: 1.2
    });
    expect(rows.map(([k]) => k)).toEqual(["rsi", "ema9", "volume_vs_adv"]);
  });

  test("buildLayerAlignmentLine stays short and non-repetitive", () => {
    const line = buildLayerAlignmentLine(
      { key: "news", name: "News", status: "Bullish", explanation: "", score: 100 },
      "Bullish",
      "supportive",
      "100"
    );
    expect(line).toBe("Supporting your bullish setup.");
    expect(line).not.toMatch(/100\/100/);
  });

  test("layerDataConfidenceTier uses article coverage for news", () => {
    expect(layerDataConfidenceTier({ key: "news", name: "News", status: "Bearish", explanation: "", score: 0, articleCount: 1 })).toBe(
      "Medium"
    );
    expect(layerDataConfidenceTier({ key: "news", name: "News", status: "Bearish", explanation: "", score: 0, articleCount: 0 })).toBe(
      "Low"
    );
  });

  test("buildLayerDrivers collects reasoning + layer-specific evidence facts", () => {
    // News: reasoning + headlines feed the AI narration material.
    const newsDrivers = buildLayerDrivers(newsLayer({ reasoning: "Two upgrades post-earnings." }));
    expect(newsDrivers[0]).toBe("Two upgrades post-earnings.");
    expect(newsDrivers).toContain("Headline A");

    // Internals: breadth + participation surfaced as drivers.
    const internalsDrivers = buildLayerDrivers({
      key: "internals",
      name: "Internals",
      status: "Bullish",
      explanation: "",
      score: 58,
      breadthSignal: "Advancers lead 3:1",
      participationSignal: "70% above 50DMA"
    });
    expect(internalsDrivers).toContain("Breadth: Advancers lead 3:1");
    expect(internalsDrivers).toContain("Participation: 70% above 50DMA");

    // Caps at 8 drivers.
    expect(buildLayerDrivers(newsLayer()).length).toBeLessThanOrEqual(8);
  });

  test("single headline at score floor softens supportive alignment copy", () => {
    const line = buildLayerAlignmentLine(
      { key: "news", name: "News", status: "Bearish", explanation: "", score: 0, articleCount: 1 },
      "Bearish",
      "supportive",
      "0"
    );
    expect(line).toMatch(/low-conviction/i);
  });
});
