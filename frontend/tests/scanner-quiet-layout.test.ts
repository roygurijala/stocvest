import { describe, expect, test } from "vitest";

import {
  buildClosestToQualifyingLines,
  buildScannerCauseBullets,
  buildScannerQuietSubline
} from "@/lib/scanner-quiet-copy";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";

const emptyOverview = {
  setups: [],
  gapIntelligence: [],
  regimeLabel: "Neutral",
  spyPct: -0.16,
  qqqPct: -0.12,
  swingUniverseSymbolCount: 13,
  gapIntelligenceSnapshotSymbolCount: null,
  watchlistStatus: null
};

function emptySummary() {
  return buildScannerScanSummary({
    scannedAtIso: "2026-05-16T14:30:00.000Z",
    overview: emptyOverview,
    nearQualificationSetups: [],
    watchlistProgression: []
  });
}

const synthesis: ScannerSynthesis = {
  qualified_count: 0,
  market_summary: "Broad market volume is low.",
  what_would_change: "Watch SPY.",
  session_time_et: "11:00 AM",
  volume_context: {
    avg_pct_below: 72,
    trend: "stable",
    time_of_day: "mid",
    recovery_likely: false,
    market_condition: "Low participation"
  },
  near_misses: [
    {
      symbol: "NVDA",
      pct_of_needed: 17,
      structure_note: "Price structure intact",
      is_market_proxy: false
    }
  ],
  rejection_groups: {
    session_volume: [{ symbol: "SPY", pct_below: 68 }],
    liquidity: [{ symbol: "WARP" }],
    structure: []
  }
};

describe("scanner quiet copy", () => {
  test("quiet subline uses market participation framing", () => {
    const line = buildScannerQuietSubline(emptySummary(), synthesis);
    expect(line).toMatch(/Market quiet/i);
    expect(line).not.toMatch(/Universe/i);
    expect(line).not.toMatch(/Gaps 0/i);
  });

  test("cause bullets are three interpretation lines", () => {
    const bullets = buildScannerCauseBullets(emptySummary(), synthesis);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toMatch(/participation/i);
  });

  test("closest lines prefer synthesis near misses", () => {
    const lines = buildClosestToQualifyingLines(synthesis, emptySummary());
    expect(lines[0]?.symbol).toBe("NVDA");
  });
});
