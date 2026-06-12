"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { postDeskRefresh, DeskRefreshCooldownError } from "@/lib/api/desk-refresh";
import type { DeskTodayResponse } from "@/lib/api/desk-today";
import {
  canDeskManualRefreshNow,
  deskManualRefreshCooldownRemainingMs,
  formatCooldownRemaining,
  markDeskManualRefreshAt
} from "@/lib/dashboard/desk-manual-refresh";
import { formatDeskRefreshErrorMessage } from "@/lib/dashboard/desk-refresh-present";
import { DESK_MANUAL_REFRESH_COOLDOWN_MS } from "@/lib/dashboard/desk-refresh-tiers";
import { deskResponseHasLeaders, isDeskCacheMiss } from "@/lib/dashboard/desk-response";

const SESSION_KEY = "stocvest:trading-room:desk:auto-refresh";

function needsDeskWarmup(
  res: DeskTodayResponse | null | undefined,
  gapFallbackCount: number
): boolean {
  if (!isDeskCacheMiss(res)) return false;
  if (deskResponseHasLeaders(res)) return false;
  if (gapFallbackCount > 0) return false;
  return true;
}

/**
 * When either desk lane is cold, revalidate and (once per session) POST desk/refresh
 * so movers/discovery populate without manual intervention.
 */
export function useTradingRoomDeskAutoLoad(opts: {
  dayTradingSurfaces: boolean;
  swingDesk: DeskTodayResponse | null | undefined;
  dayDesk: DeskTodayResponse | null | undefined;
  scannerDataSettled: boolean;
  gapFallbackCount: number;
  revalidateSwingDesk: () => Promise<DeskTodayResponse | null | undefined>;
  revalidateDayDesk: () => Promise<DeskTodayResponse | null | undefined>;
}): { deskWarmupLoading: boolean } {
  const {
    dayTradingSurfaces,
    swingDesk,
    dayDesk,
    scannerDataSettled,
    gapFallbackCount,
    revalidateSwingDesk,
    revalidateDayDesk
  } = opts;

  const autoRefreshStarted = useRef(false);
  const [warmupBusy, setWarmupBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);

  const swingCold = needsDeskWarmup(swingDesk, gapFallbackCount);
  const dayCold = dayTradingSurfaces && needsDeskWarmup(dayDesk, gapFallbackCount);
  const anyCold = swingCold || dayCold;

  useEffect(() => {
    const tick = () => setCooldownMs(deskManualRefreshCooldownRemainingMs());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [manualBusy]);

  useEffect(() => {
    if (!scannerDataSettled) return;
    if (!anyCold) return;
    void Promise.all([revalidateSwingDesk(), dayTradingSurfaces ? revalidateDayDesk() : Promise.resolve()]);
  }, [
    scannerDataSettled,
    anyCold,
    dayTradingSurfaces,
    revalidateSwingDesk,
    revalidateDayDesk,
    swingDesk?.source,
    dayDesk?.source
  ]);

  const refreshDesk = useCallback(async () => {
    if (!canDeskManualRefreshNow() || manualBusy) return;
    setWarmupBusy(true);
    setManualBusy(true);
    try {
      await postDeskRefresh();
      markDeskManualRefreshAt();
      setCooldownMs(deskManualRefreshCooldownRemainingMs());
      await Promise.all([revalidateSwingDesk(), dayTradingSurfaces ? revalidateDayDesk() : Promise.resolve()]);
    } catch (err) {
      if (err instanceof DeskRefreshCooldownError) {
        markDeskManualRefreshAt(
          Date.now() - (DESK_MANUAL_REFRESH_COOLDOWN_MS - err.retryAfterSeconds * 1000)
        );
        setCooldownMs(err.retryAfterSeconds * 1000);
      } else {
        formatDeskRefreshErrorMessage(err);
        await Promise.all([revalidateSwingDesk(), dayTradingSurfaces ? revalidateDayDesk() : Promise.resolve()]);
      }
    } finally {
      setManualBusy(false);
      setWarmupBusy(false);
    }
  }, [manualBusy, dayTradingSurfaces, revalidateSwingDesk, revalidateDayDesk]);

  useEffect(() => {
    if (!scannerDataSettled || !anyCold) {
      setWarmupBusy(false);
      return;
    }
    if (!canDeskManualRefreshNow() || manualBusy || autoRefreshStarted.current) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;

    autoRefreshStarted.current = true;
    setWarmupBusy(true);
    void refreshDesk().finally(() => setWarmupBusy(false));
  }, [scannerDataSettled, anyCold, manualBusy, refreshDesk, cooldownMs]);

  useEffect(() => {
    if (!anyCold && typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    }
  }, [anyCold, swingDesk?.source, dayDesk?.source]);

  const deskWarmupLoading =
    warmupBusy ||
    (manualBusy && anyCold && !deskResponseHasLeaders(swingDesk) && !(dayDesk && deskResponseHasLeaders(dayDesk)));

  return { deskWarmupLoading };
}

export function formatDeskWarmupCooldownLabel(ms: number): string | null {
  return ms > 0 ? formatCooldownRemaining(ms) : null;
}
