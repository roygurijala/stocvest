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

/**
 * True when movers radar is fresh but the last full composite batch never populated
 * discovery / quiet / developing — triggers a one-time desk refresh, not when a full
 * batch ran and geometry legitimately filtered everything.
 */
export function swingDeskNeedsDiscoveryRefresh(res: DeskTodayResponse | null | undefined): boolean {
  const data = res?.data;
  if (!data) return false;
  const tier = String(data.tier ?? "")
    .trim()
    .toLowerCase();
  if (tier !== "movers") return false;
  const movers = Array.isArray(data.movers_radar) ? data.movers_radar.length : 0;
  if (movers === 0) return false;
  const discovery = Array.isArray(data.discovery) ? data.discovery.length : 0;
  const quiet = Array.isArray(data.quiet_leaders) ? data.quiet_leaders.length : 0;
  const developing = Array.isArray(data.developing_setups) ? data.developing_setups.length : 0;
  return discovery + quiet + developing === 0;
}
