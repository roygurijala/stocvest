import { describe, expect, test } from "vitest";
import {
  buildWatchlistRadarCardModel,
  WATCHLIST_RADAR_DISCLAIMER
} from "@/lib/dashboard/watchlist-radar-card-present";
import type { WatchlistRadarRow } from "@/lib/dashboard/watchlist-radar";

const colors = {
  surface: "#0f172a",
  border: "#334155",
  accent: "#38bdf8",
  bullish: "#4ade80",
  bearish: "#f87171",
  caution: "#fbbf24",
  textMuted: "#94a3b8"
};

function baseRow(overrides: Partial<WatchlistRadarRow> = {}): WatchlistRadarRow {
  return {
    symbol: "CCM",
    row: undefined,
    aligned: 5,
    total: 6,
    alignmentTier: "actionable",
    attentionTier: "check_now",
    alignmentLine: "Strong (5/6)",
    momentumLine: null,
    progressionBadge: null,
    blockers: [],
    evaluatedAgo: "12m ago",
    evaluatedStale: false,
    quote: { price: "$12.34", pct: "+2.1%", bullish: true },
    layerDots: [true, true, true, true, true, false],
    borderLeft: colors.bullish,
    borderBottom: colors.bullish,
    conviction: null,
    attentionReason: "Near actionable on your list",
    ...overrides
  };
}

describe("watchlist-radar-card-present", () => {
  test("disclaimer distinguishes radar from full watchlist", () => {
    expect(WATCHLIST_RADAR_DISCLAIMER.toLowerCase()).toContain("full watchlists");
  });

  test("check_now tier gets bullish badge", () => {
    const model = buildWatchlistRadarCardModel(baseRow(), colors);
    expect(model.badgeLabel).toBe("Check now");
    expect(model.attentionLine).toContain("Near actionable");
  });
});
