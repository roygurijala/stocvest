import { describe, expect, it } from "vitest";
import { buildMarketConditionsQuietCard } from "@/lib/scanner-quiet-copy";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";

describe("buildMarketConditionsQuietCard", () => {
  it("returns headline and pills for bullish quiet day", () => {
    const summary = buildScannerScanSummary({
      scannedAtIso: "2026-05-16T14:30:00.000Z",
      overview: {
        setups: [],
        gapIntelligence: [],
        regimeLabel: "Bullish",
        spyPct: 0.2,
        qqqPct: 0.15
      },
      nearQualificationSetups: [],
      watchlistProgression: []
    });
    const model = buildMarketConditionsQuietCard(summary, {
      qualified_count: 0,
      market_summary: "",
      what_would_change: "",
      session_time_et: "10:00",
      volume_context: { market_condition: "low", avg_pct_below: 99 },
      near_misses: [],
      rejection_groups: {
        session_volume: [
          { symbol: "NVDA", pct_below: 90 },
          { symbol: "TSLA", pct_below: 85 }
        ],
        liquidity: [],
        structure: []
      }
    });
    expect(model.headline).toMatch(/Market quiet/i);
    expect(model.environmentQuality.label).toMatch(/Weak|Mixed/i);
    expect(model.focusHint).toMatch(/Focus:/i);
    expect(model.regimePill.label).toMatch(/Bullish/);
    expect(model.breadthPill.label).toMatch(/selective/i);
    expect(model.bodyParagraphs.some((p) => /Volume is the primary blocker/i.test(p))).toBe(true);
    expect(model.bodyParagraphs.some((p) => /NVDA/i.test(p))).toBe(true);
  });
});
