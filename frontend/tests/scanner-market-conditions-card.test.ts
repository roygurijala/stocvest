import { describe, expect, it } from "vitest";
import {
  buildMarketConditionsQuietCard,
  buildScannerQuietSubline,
  quietScanCauseIsObvious,
  shouldShowQuietWhatWouldChangeSection
} from "@/lib/scanner-quiet-copy";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";

describe("buildMarketConditionsQuietCard", () => {
  it("separates bullish regime context from volume blocker", () => {
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
    const synthesis = {
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
    };
    const model = buildMarketConditionsQuietCard(summary, synthesis);
    expect(buildScannerQuietSubline(summary, synthesis)).toMatch(/session volume below pace/i);
    expect(model.headline).toMatch(/session volume below pace/i);
    expect(model.regimeContextLine).toMatch(/Bullish.*not the blocker/i);
    expect(model.volumeBlockerLine).toMatch(/85–90% below session pace/i);
    expect(model.volumeBlockerLine).toMatch(/why no setups have qualified/i);
    expect(model.regimeContextTone).toBe("ok");
    expect(model.focusHint).toMatch(/especially TSLA and NVDA/i);
    expect(quietScanCauseIsObvious(summary, synthesis)).toBe(true);
    expect(shouldShowQuietWhatWouldChangeSection(summary, synthesis)).toBe(false);
  });
});
