import { describe, expect, test } from "vitest";
import {
  buildCausalNarrativeFromRows,
  causalBulletsForWhyNot,
  parseCausalNarrativeFromApi
} from "@/lib/signal-evidence/causal-narrative";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

function row(
  key: string,
  name: string,
  status: SignalsLayerRowInput["status"],
  explanation = ""
): SignalsLayerRowInput {
  return { key, name, status, explanation, score: 50 };
}

describe("buildCausalNarrativeFromRows", () => {
  test("bullish setup with macro and sector headwinds builds chain", () => {
    const narrative = buildCausalNarrativeFromRows({
      signalSummary: "bullish",
      rows: [
        row("macro", "Macro", "Bearish", "Risk-off tape: SPY weak and VIX firm."),
        row("geopolitical", "Geopolitical", "Neutral"),
        row("internals", "Market Internals", "Bearish"),
        row("sector", "Sector", "Bearish"),
        row("news", "News", "Neutral"),
        row("technical", "Technical", "Neutral")
      ]
    });
    expect(narrative.chain.length).toBeGreaterThanOrEqual(2);
    expect(narrative.chain[0]?.layer).toBe("macro");
    expect(narrative.summary.toLowerCase()).not.toMatch(/buy|sell|consider/);
  });

  test("aligned bearish setup has empty chain", () => {
    const narrative = buildCausalNarrativeFromRows({
      signalSummary: "bearish",
      rows: [
        row("macro", "Macro", "Bearish"),
        row("sector", "Sector", "Bearish"),
        row("technical", "Technical", "Bearish"),
        row("news", "News", "Neutral"),
        row("geopolitical", "Geopolitical", "Neutral"),
        row("internals", "Market Internals", "Bearish")
      ]
    });
    expect(narrative.chain).toHaveLength(0);
  });
});

describe("parseCausalNarrativeFromApi", () => {
  test("parses backend snake_case payload", () => {
    const parsed = parseCausalNarrativeFromApi({
      informational_only: true,
      setup_bias: "bullish",
      summary: "Macro is the main environmental headwind.",
      chain: [
        {
          layer: "macro",
          name: "Macro",
          polarity: "blocking",
          role: "root_cause",
          headline: "Macro is the main environmental headwind",
          because: "Risk-off tape.",
          caused_by: []
        }
      ],
      chain_label: "Macro"
    });
    expect(parsed?.summary).toContain("Macro");
    expect(parsed?.chain).toHaveLength(1);
  });
});

describe("causalBulletsForWhyNot", () => {
  test("includes summary and layer tags", () => {
    const narrative = buildCausalNarrativeFromRows({
      signalSummary: "bullish",
      rows: [
        row("macro", "Macro", "Bearish"),
        row("technical", "Technical", "Bearish"),
        row("sector", "Sector", "Neutral"),
        row("news", "News", "Neutral"),
        row("geopolitical", "Geopolitical", "Neutral"),
        row("internals", "Market Internals", "Neutral")
      ]
    });
    const bullets = causalBulletsForWhyNot(narrative, 4);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets[0]).toBe(narrative.summary);
  });
});
