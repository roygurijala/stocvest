/**
 * Overlay per-symbol evaluation timestamps onto feed cards.
 */

import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export function resolveFeedCardLastEvaluatedAt(
  card: Pick<FeedCard, "symbol" | "lane">,
  opts: {
    swingBySymbol: Record<string, WatchlistMaturationRow>;
    dayBySymbol?: Record<string, WatchlistMaturationRow>;
    swingDeskGeneratedAt?: string | null;
    dayDeskGeneratedAt?: string | null;
  }
): string | null {
  const sym = card.symbol.trim().toUpperCase();
  const row = card.lane === "day" ? opts.dayBySymbol?.[sym] : opts.swingBySymbol[sym];
  const maturationIso = row?.last_evaluated_at?.trim() || null;
  if (maturationIso) return maturationIso;
  const deskIso = card.lane === "day" ? opts.dayDeskGeneratedAt : opts.swingDeskGeneratedAt;
  return deskIso?.trim() || null;
}

export function overlayFeedCardTimestamps(
  cards: FeedCard[],
  opts: {
    swingBySymbol: Record<string, WatchlistMaturationRow>;
    dayBySymbol?: Record<string, WatchlistMaturationRow>;
    swingDeskGeneratedAt?: string | null;
    dayDeskGeneratedAt?: string | null;
  }
): FeedCard[] {
  return cards.map((card) => ({
    ...card,
    lastEvaluatedAt: resolveFeedCardLastEvaluatedAt(card, opts)
  }));
}
