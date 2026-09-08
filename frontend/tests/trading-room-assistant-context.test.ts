import { describe, expect, it } from "vitest";
import { buildTradingRoomAssistantPageContext } from "@/lib/dashboard/trading-room/trading-room-assistant-context";
import { DEFAULT_FEED_FILTERS } from "@/lib/dashboard/trading-room/feed-model";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

function feedCard(symbol: string): FeedCard {
  return {
    id: `swing:${symbol}`,
    symbol,
    company: null,
    lane: "swing",
    state: "actionable",
    bias: "bull",
    verdict: "Ready",
    phase: null,
    price: 10,
    changePct: 1,
    alignment: { aligned: 5, total: 6 },
    rankScore: 5,
    source: "desk",
    setupTier: "setup",
    lastEvaluatedAt: null
  };
}

describe("trading-room-assistant-context (ADR-003 UX-D8)", () => {
  it("mirrors visible feed cards and brief expand state", () => {
    const ctx = buildTradingRoomAssistantPageContext({
      centerView: "brief",
      briefExpanded: true,
      filters: DEFAULT_FEED_FILTERS,
      visibleFeedCards: [feedCard("AAPL"), feedCard("MSFT")],
      watchlistOpen: false,
      watchlistViewMode: "heat",
      regimeLabel: "Risk-on",
      deskCounts: { actionable: 2, near: 1, potential: 3, cooling: 0 }
    });

    expect(ctx.page).toBe("dashboard");
    expect(ctx.trading_room_context?.brief_expanded).toBe(true);
    expect(ctx.trading_room_context?.feed_visible_symbols).toEqual(["AAPL", "MSFT"]);
    expect(ctx.trading_room_context?.feed_filter_state).toBe("actionable_near");
    expect(ctx.trading_room_context?.watchlist_view_mode).toBe("heat");
    expect(ctx).not.toHaveProperty("dashboard_context");
  });

  it("includes symbol when deep dive is active", () => {
    const ctx = buildTradingRoomAssistantPageContext({
      centerView: "deep_dive",
      selectedSymbol: "nvda",
      briefExpanded: false,
      filters: DEFAULT_FEED_FILTERS,
      visibleFeedCards: [],
      watchlistOpen: true,
      watchlistViewMode: "list",
      regimeLabel: "Neutral",
      deskCounts: { actionable: 0, near: 0, potential: 0, cooling: 0 }
    });

    expect(ctx.symbol).toBe("NVDA");
    expect(ctx.trading_room_context?.center_view).toBe("deep_dive");
    expect(ctx.trading_room_context?.watchlist_rail_open).toBe(true);
  });
});
