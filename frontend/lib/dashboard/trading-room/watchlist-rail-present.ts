/**
 * ADR-003 UX-D7 — Watchlist rail heat presentation (pure).
 */

import type { SnapshotPayload } from "@/lib/api/market";
import { vixSnapshotSessionChangePct } from "@/lib/api/market-snapshot-helpers";
import type { FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { WatchlistQualityTier } from "@/lib/dashboard/position-ranked-home-present";

export type WatchlistRailViewMode = "list" | "heat";

// ADR-004 POS-D14 — Position desk gold for the "Gem" quality dot (mirrors
// `roleAccents.position.accent` on `/dashboard/invest`, theme-independent).
export const POSITION_GEM_GOLD = "#fbbf24";

/** Color for the watchlist investment-quality tier dot (POS-D14). Pure — takes only the
 * two semantic tones it needs so both `Colors` and `ThemeColors` satisfy it. */
export function watchlistQualityDotColor(
  tier: WatchlistQualityTier,
  colors: { bullish: string; textMuted: string }
): string {
  if (tier === "gem") return POSITION_GEM_GOLD;
  if (tier === "strong") return colors.bullish;
  return colors.textMuted; // monitor
}

/** Performance window for watchlist heat cells. */
export type WatchlistHeatWindow = "1d" | "1w" | "3m" | "ytd";

export const WATCHLIST_HEAT_WINDOWS: readonly WatchlistHeatWindow[] = ["1d", "1w", "3m", "ytd"];

export const WATCHLIST_HEAT_WINDOW_LABEL: Record<WatchlistHeatWindow, string> = {
  "1d": "1D",
  "1w": "1W",
  "3m": "3M",
  ytd: "YTD"
};

export const WATCHLIST_HEAT_STATE_BADGE: Partial<Record<FeedState, string>> = {
  actionable: "Actionable",
  near: "Near"
};

export function watchlistHeatShowsStateBadge(state: FeedState): boolean {
  return state === "actionable" || state === "near";
}

export function watchlistHeatStateBadgeLabel(state: FeedState): string | null {
  return WATCHLIST_HEAT_STATE_BADGE[state] ?? null;
}

/** Session % for heat cells — same fallbacks as the desk feed and sector holdings grid. */
export function watchlistSessionChangePct(snap: SnapshotPayload | undefined): number | null {
  return vixSnapshotSessionChangePct(snap);
}
