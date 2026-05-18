import { describe, expect, test } from "vitest";

import {
  buildClosestToQualifyingGroups,
  buildScannerCauseBullets,
  buildScannerDeskInterpretiveLine,
  buildScannerQuietSubline,
  buildWatchlistQuietInsight
} from "@/lib/scanner-quiet-copy";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";

const emptyOverview = {
  setups: [],
  gapIntelligence: [],
  regimeLabel: "Bearish",
  spyPct: -0.16,
  qqqPct: -0.12,
  swingUniverseSymbolCount: 13,
  gapIntelligenceSnapshotSymbolCount: null,
  watchlistStatus: { monitored: 11, actionable: 0, developing: 11, inactive: 0 }
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
      symbol: "AMZN",
      pct_of_needed: 8,
      structure_note: "Session pace lagging; price structure not the primary block",
      is_market_proxy: false
    },
    {
      symbol: "NVDA",
      pct_of_needed: 12,
      structure_note: "Session pace lagging",
      is_market_proxy: false
    }
  ],
  rejection_groups: {
    session_volume: [
      { symbol: "AMZN", pct_below: 92 },
      { symbol: "NVDA", pct_below: 88 },
      { symbol: "SPY", pct_below: 68 }
    ],
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

  test("cause bullets include concrete participation and leaders", () => {
    const bullets = buildScannerCauseBullets(emptySummary(), synthesis);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toMatch(/intraday norms/i);
    expect(bullets[1]).toMatch(/NVDA|AMZN|Mega-cap/i);
    expect(bullets[2]).toMatch(/Bearish regime/i);
  });

  test("closest groups use volume percentages", () => {
    const groups = buildClosestToQualifyingGroups(synthesis, emptySummary());
    expect(groups.some((g) => g.label === "Volume constrained")).toBe(true);
    const vol = groups.find((g) => g.label === "Volume constrained");
    expect(vol?.items.some((i) => i.symbol === "AMZN" && i.detail.includes("92"))).toBe(true);
  });

  test("desk interpretive lines are single decisive sentences", () => {
    expect(buildScannerDeskInterpretiveLine("gap", { regimeLabel: "Bearish" })).toMatch(
      /overnight gaps met magnitude/i
    );
    expect(buildScannerDeskInterpretiveLine("swing", { regimeLabel: "Bearish" })).toMatch(
      /Bearish regime is preventing/i
    );
    expect(
      buildScannerDeskInterpretiveLine("day", { regimeLabel: "Bearish", marketStatus: { market: "closed" } })
    ).toMatch(/session closed/i);
  });

  test("watchlist quiet insight is forward-looking", () => {
    const insight = buildWatchlistQuietInsight(emptyOverview.watchlistStatus!, 0);
    expect(insight?.headline).toMatch(/active but not ready/i);
    expect(insight?.subline).toMatch(/11 developing/);
    expect(insight?.subline).toMatch(/none confirmed/i);
  });
});
