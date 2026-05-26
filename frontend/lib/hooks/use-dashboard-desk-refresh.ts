"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";

import { DeskRefreshCooldownError, postDeskRefresh } from "@/lib/api/desk-refresh";
import { fetchDeskToday, type DeskTodayMode, type DeskTodayResponse } from "@/lib/api/desk-today";
import {
  canDeskManualRefreshNow,
  deskManualRefreshCooldownRemainingMs,
  formatCooldownRemaining,
  markDeskManualRefreshAt
} from "@/lib/dashboard/desk-manual-refresh";
import {
  DESK_MANUAL_REFRESH_COOLDOWN_MS,
  DESK_REFRESH_TIER_B_MS,
  shouldPollDeskTier
} from "@/lib/dashboard/desk-refresh-tiers";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";

/**
 * Desk today SWR + manual refresh. Desk payload is client-fetched — do not call
 * `router.refresh()` here; it re-streams the whole dashboard RSC tree and races
 * with the deferred scanner Suspense boundary (`Connection closed` crash).
 */
export function useDashboardDeskRefresh(mode: DeskTodayMode) {
  const refreshInterval = shouldPollDeskTier("movers") ? DESK_REFRESH_TIER_B_MS : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    deskTodayKey(mode),
    async ([, m]: readonly [string, DeskTodayMode]) => fetchDeskToday(m),
    { refreshInterval }
  );

  const [manualBusy, setManualBusy] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setCooldownMs(deskManualRefreshCooldownRemainingMs());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [manualBusy]);

  const refreshDesk = useCallback(async () => {
    if (!canDeskManualRefreshNow() || manualBusy) return;
    setRefreshError(null);
    setManualBusy(true);
    try {
      await postDeskRefresh();
      markDeskManualRefreshAt();
      setCooldownMs(deskManualRefreshCooldownRemainingMs());
      await mutate();
    } catch (err) {
      if (err instanceof DeskRefreshCooldownError) {
        markDeskManualRefreshAt(
          Date.now() - (DESK_MANUAL_REFRESH_COOLDOWN_MS - err.retryAfterSeconds * 1000)
        );
        setCooldownMs(err.retryAfterSeconds * 1000);
        setRefreshError(`On cooldown — try again in ${formatCooldownRemaining(err.retryAfterSeconds * 1000)}.`);
      } else {
        setRefreshError(err instanceof Error ? err.message : "Refresh failed");
        await mutate();
      }
    } finally {
      setManualBusy(false);
    }
  }, [manualBusy, mutate]);

  const canManualRefresh = canDeskManualRefreshNow() && !manualBusy;

  return {
    data: (data ?? null) as DeskTodayResponse | null,
    error,
    isLoading,
    isValidating,
    mutate,
    refreshDesk,
    manualRefreshBusy: manualBusy,
    canManualRefresh,
    cooldownRemainingMs: cooldownMs,
    cooldownLabel: cooldownMs > 0 ? formatCooldownRemaining(cooldownMs) : null,
    refreshError
  };
}
