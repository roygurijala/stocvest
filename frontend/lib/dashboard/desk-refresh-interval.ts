import type { DeskTodayResponse } from "@/lib/api/desk-today";
import { DESK_REFRESH_TIER_B_MS, shouldPollDeskTier } from "@/lib/dashboard/desk-refresh-tiers";
import { isDeskCacheMiss } from "@/lib/dashboard/desk-response";

export const DESK_CACHE_MISS_RETRY_MS = 60_000;

/** SWR refreshInterval for desk-today — aggressive retry on cold cache, tier B otherwise. */
export function deskTodayRefreshIntervalMs(latest: DeskTodayResponse | undefined): number {
  if (isDeskCacheMiss(latest)) return DESK_CACHE_MISS_RETRY_MS;
  return shouldPollDeskTier("movers") ? DESK_REFRESH_TIER_B_MS : 0;
}
