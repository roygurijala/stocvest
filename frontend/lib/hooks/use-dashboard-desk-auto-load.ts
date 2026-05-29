"use client";

import { useEffect, useRef, useState } from "react";
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
 * a manual refresh. Re-fetch after cache miss; run desk refresh when empty so movers
 * populate without hunting the button.
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
}): { sessionActivityLoading: boolean } {
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
  const [autoRefreshBusy, setAutoRefreshBusy] = useState(false);

  useEffect(() => {
    if (!scannerDataSettled) return;
    if (deskToday?.source === "cache") return;
    void revalidateDesk();
  }, [scannerDataSettled, deskToday?.source, revalidateDesk]);

  useEffect(() => {
    if (deskHasSessionLeaders(deskToday)) {
      setAutoRefreshBusy(false);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(autoRefreshStorageKey(mode), "1");
      }
      return;
    }
    if (gapFallbackCount > 0) {
      setAutoRefreshBusy(false);
      return;
    }
    if (deskToday?.source !== "cache_miss") {
      setAutoRefreshBusy(false);
      return;
    }
    if (!canManualRefresh || manualRefreshBusy || autoRefreshStarted.current) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(autoRefreshStorageKey(mode)) === "1") return;

    autoRefreshStarted.current = true;
    setAutoRefreshBusy(true);
    void refreshDesk().finally(() => setAutoRefreshBusy(false));
  }, [
    deskToday,
    gapFallbackCount,
    canManualRefresh,
    manualRefreshBusy,
    refreshDesk,
    mode
  ]);

  const sessionActivityLoading =
    autoRefreshBusy ||
    (manualRefreshBusy &&
      deskToday?.source === "cache_miss" &&
      !deskHasSessionLeaders(deskToday) &&
      gapFallbackCount === 0);

  return { sessionActivityLoading };
}
