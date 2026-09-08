/**
 * ADR-003 UX-D8 — Trading Room assistant page context (pure).
 *
 * Mirrors on-screen tiers only: visible feed cards, brief expand state, feed filters.
 * Does not include symbols removed from the UI (e.g. market swing setups table).
 */

import type { FeedCard, FeedFilters, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { AssistantPageContext, TradingRoomAssistantContextV1 } from "@/lib/assistant/types";
import type { WatchlistRailViewMode } from "@/lib/dashboard/trading-room/watchlist-rail-present";

export const TRADING_ROOM_CONTEXT_VERSION = 1 as const;

export type BuildTradingRoomAssistantContextInput = {
  centerView: "brief" | "deep_dive";
  selectedSymbol?: string | null;
  briefExpanded: boolean;
  filters: FeedFilters;
  visibleFeedCards: readonly FeedCard[];
  watchlistOpen: boolean;
  watchlistViewMode: WatchlistRailViewMode;
  regimeLabel: string;
  deskCounts: Record<FeedState, number>;
};

function mapFeedFilterState(state: FeedFilters["state"]): TradingRoomAssistantContextV1["feed_filter_state"] {
  return state;
}

export function buildTradingRoomAssistantPageContext(
  input: BuildTradingRoomAssistantContextInput
): AssistantPageContext {
  const visibleSymbols = input.visibleFeedCards.map((c) => c.symbol.trim().toUpperCase()).filter(Boolean);

  const trading_room_context: TradingRoomAssistantContextV1 = {
    version: TRADING_ROOM_CONTEXT_VERSION,
    center_view: input.centerView,
    brief_expanded: input.briefExpanded,
    feed_filter_lane: input.filters.lane,
    feed_filter_state: mapFeedFilterState(input.filters.state),
    feed_filter_bias: input.filters.bias,
    feed_visible_count: visibleSymbols.length,
    feed_visible_symbols: visibleSymbols.slice(0, 12),
    watchlist_rail_open: input.watchlistOpen,
    watchlist_view_mode: input.watchlistViewMode,
    desk_actionable_count: input.deskCounts.actionable,
    desk_near_count: input.deskCounts.near,
    desk_potential_count: input.deskCounts.potential
  };

  const ctx: AssistantPageContext = {
    page: "dashboard",
    market_regime: input.regimeLabel.trim() || "Neutral",
    ranked_setups_count: visibleSymbols.length,
    trading_room_context
  };

  if (input.centerView === "deep_dive" && input.selectedSymbol?.trim()) {
    ctx.symbol = input.selectedSymbol.trim().toUpperCase();
  }

  return ctx;
}
