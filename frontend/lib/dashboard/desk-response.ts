import type { DeskTodayData, DeskTodayResponse } from "@/lib/api/desk-today";

/** Desk payload has discovery and/or movers to render session cards. */
export function deskResponseHasLeaders(res: DeskTodayResponse | null | undefined): boolean {
  const d = res?.data;
  if (!d) return false;
  const discovery = Array.isArray(d.discovery) ? d.discovery.length : 0;
  const movers = Array.isArray(d.movers_radar) ? d.movers_radar.length : 0;
  return discovery > 0 || movers > 0;
}

/** True when the live Redis key is empty and no stale backup was served. */
export function isDeskCacheMiss(res: DeskTodayResponse | null | undefined): boolean {
  return res?.source === "cache_miss" && !res?.data;
}

/** Served from the long-lived stale backup after the primary key expired. */
export function isDeskCacheStale(res: DeskTodayResponse | null | undefined): boolean {
  return res?.source === "cache_stale" && !!res?.data;
}

export function deskDataFromResponse(res: DeskTodayResponse | null | undefined): DeskTodayData | null {
  return res?.data ?? null;
}
