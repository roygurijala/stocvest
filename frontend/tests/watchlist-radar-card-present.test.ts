import { describe, expect, test } from "vitest";
import {
  buildWatchlistRadarCardModel,
  resolveWatchlistCardTone,
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
    chromeKind: "actionable_ready",
    dotAccent: colors.bullish,
    chromeBadgeLabel: "Ready",
    chromeBadgeColor: colors.bullish,
    chromeBadgeBackground: `color-mix(in srgb, ${colors.bullish} 20%, transparent)`,
    directionChip: null,
    statusBanner: null,
    conviction: null,
    attentionLine: "Strong setup — desk gated (bearish regime)",
    attentionReason: "Strong setup — desk gated (bearish regime)",
    sessionMovePct: 2.4,
    ...overrides
  };
}

describe("watchlist-radar-card-present", () => {
  test("disclaimer distinguishes radar from full watchlist", () => {
    expect(WATCHLIST_RADAR_DISCLAIMER.toLowerCase()).toContain("open watchlists");
  });

  test("check_now tier gets bullish badge", () => {
    const model = buildWatchlistRadarCardModel(baseRow(), colors);
    expect(model.badgeLabel).toBe("Check now");
    expect(model.attentionLine).toContain("desk gated");
  });

  test("disclaimer explains strong vs desk gated", () => {
    expect(WATCHLIST_RADAR_DISCLAIMER.toLowerCase()).toContain("desk gated");
  });

  test("resolveWatchlistCardTone uses session move when quote missing", () => {
    expect(resolveWatchlistCardTone({ quoteBullish: null, sessionMovePct: -3.2 })).toBe("bearish");
    expect(resolveWatchlistCardTone({ quoteBullish: null, sessionMovePct: 1.1 })).toBe("bullish");
  });

  test("card borders follow alignment chrome not session price tone", () => {
    const model = buildWatchlistRadarCardModel(
      baseRow({
        quote: { price: "$10.00", pct: "-2.00%", bullish: false },
        borderLeft: colors.bullish,
        borderBottom: colors.bullish,
        dotAccent: colors.bullish
      }),
      colors
    );
    expect(model.quoteTone).toBe("bearish");
    expect(model.borderLeft).toBe(colors.bullish);
    expect(model.dotAccent).toBe(colors.bullish);
  });
});
