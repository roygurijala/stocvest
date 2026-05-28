"use client";

import { useEffect, useRef } from "react";
import type { DeskTodayResponse } from "@/lib/api/desk-today";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

function deskHasSessionLeaders(data: DeskTodayResponse | null | undefined): boolean {
  const d = data?.data;
  if (!d) return false;
  const discovery = Array.isArray(d.discovery) ? d.discovery.length : 0;
  const movers = Array.isArray(d.movers_radar) ? d.movers_radar.length : 0;
  return discovery > 0 || movers > 0;
}

function autoRefreshStorageKey(mode: DashboardDeskMode): string {
  return `stocvest:desk:auto-refresh:${mode}`;
}

/**
 * When the Opportunity Desk Redis cache is empty, session activity stays blank until
 * a manual refresh. Re-fetch after scanner settles; optionally run one refresh per
 * browser session so movers populate without hunting the button.
 */
export function useDashboardDeskAutoLoad(opts: {
  mode: DashboardDeskMode;
  deskToday: DeskTodayResponse | null | undefined;
  scannerDataSettled: boolean;
  gapFallbackCount: number;
  canManualRefresh: boolean;
  manualRefreshBusy: boolean;
  refreshDesk: () => Promise<void>;
  revalidateDesk: () => Promise<DeskTodayResponse | null | undefined>;
}): void {
  const {
    mode,
    deskToday,
    scannerDataSettled,
    gapFallbackCount,
    canManualRefresh,
    manualRefreshBusy,
    refreshDesk,
    revalidateDesk
  } = opts;
  const autoRefreshStarted = useRef(false);

  useEffect(() => {
    if (!scannerDataSettled) return;
    if (deskToday?.source === "cache") return;
    void revalidateDesk();
  }, [scannerDataSettled, deskToday?.source, revalidateDesk]);

  useEffect(() => {
    if (!scannerDataSettled) return;
    if (manualRefreshBusy || autoRefreshStarted.current) return;
    if (deskHasSessionLeaders(deskToday)) return;
    if (gapFallbackCount > 0) return;
    if (deskToday?.source !== "cache_miss") return;
    if (!canManualRefresh) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(autoRefreshStorageKey(mode)) === "1") return;

    autoRefreshStarted.current = true;
    window.sessionStorage.setItem(autoRefreshStorageKey(mode), "1");
    void refreshDesk();
  }, [
    scannerDataSettled,
    manualRefreshBusy,
    deskToday,
    gapFallbackCount,
    canManualRefresh,
    refreshDesk,
    mode
  ]);
}
