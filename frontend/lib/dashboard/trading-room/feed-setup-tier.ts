import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

/** Desk movers vs vetted discovery / scanner setups. */
export type FeedSetupTier = "mover" | "setup";

export function isMoverFeedCard(card: FeedCard): boolean {
  return card.setupTier === "mover";
}

/**
 * Session movers get context-only deep dive — no scenario geometry, desk R/R gate,
 * or What-If planner. Vetted setups keep the full stack.
 */
export function feedCardAllowsScenarioGeometry(card: FeedCard): boolean {
  return !isMoverFeedCard(card);
}
