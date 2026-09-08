/**
 * ADR-003 UX-D7 — Watchlist rail heat presentation (pure).
 */

import type { SnapshotPayload } from "@/lib/api/market";
import { vixSnapshotSessionChangePct } from "@/lib/api/market-snapshot-helpers";
import type { FeedState } from "@/lib/dashboard/trading-room/feed-model";

export type WatchlistRailViewMode = "list" | "heat";

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
