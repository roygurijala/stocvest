"use client";

import { useEffect, useRef, useState } from "react";
import type { DeskTodayResponse } from "@/lib/api/desk-today";
import { deskResponseHasLeaders, isDeskCacheMiss } from "@/lib/dashboard/desk-response";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

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
    if (!isDeskCacheMiss(deskToday)) return;
    void revalidateDesk();
  }, [scannerDataSettled, deskToday?.source, deskToday?.data, revalidateDesk]);

  useEffect(() => {
    if (deskResponseHasLeaders(deskToday)) {
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
      isDeskCacheMiss(deskToday) &&
      !deskResponseHasLeaders(deskToday) &&
      gapFallbackCount === 0);

  return { sessionActivityLoading };
}
