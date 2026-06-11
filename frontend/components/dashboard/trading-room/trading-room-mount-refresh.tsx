"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { WatchlistSessionRefreshOrchestrator } from "@/components/watchlists/watchlist-session-refresh-orchestrator";
import { ensureSessionReady } from "@/lib/auth/ensure-session-ready";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";
import { WATCHLIST_MATURATION_UPDATED_EVENT } from "@/lib/watchlist-maturation-bump";
import {
  fetchDefaultWatchlistSymbols,
  refreshTradingRoomSidebarMaturation,
  TRADING_ROOM_MATURATION_MAX_AGE_MS,
  TRADING_ROOM_MOUNT_MAX_SYMBOLS
} from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";

type Props = {
  dayTradingSurfaces: boolean;
  /** Symbols visible in the signal feed — refreshed when the list first loads or changes. */
  sidebarSymbols: string[];
};

/** Brief defer so desk/vix BFF routes can warm Lambdas before composite refresh. */
const MOUNT_REFRESH_DEFER_MS = 1_500;

function bumpMaturationConsumers(): void {
  window.dispatchEvent(new CustomEvent(WATCHLIST_MATURATION_UPDATED_EVENT));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trading-room mount hook-up: revalidate desk payloads, refetch maturation-summary,
 * run session-stale composite refresh (orchestrator), and re-composite stale feed +
 * watchlist symbols on page load (TTL-gated, capped).
 */
export function TradingRoomMountRefresh({ dayTradingSurfaces, sidebarSymbols }: Props) {
  const { mutate } = useSWRConfig();
  const symbolsKey = sidebarSymbols.join(",");

  useEffect(() => {
    void mutate(deskTodayKey("swing"), undefined, { revalidate: true });
    void mutate(deskTodayKey("day"), undefined, { revalidate: true });
    bumpMaturationConsumers();
  }, [mutate]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const sessionOk = await ensureSessionReady();
      if (!sessionOk || cancelled) return;
      await sleep(MOUNT_REFRESH_DEFER_MS);
      if (cancelled) return;

      const watchlistSymbols = await fetchDefaultWatchlistSymbols();
      const combined = [
        ...new Set(
          [...sidebarSymbols, ...watchlistSymbols].map((s) => s.trim().toUpperCase()).filter(Boolean)
        )
      ];
      if (combined.length === 0) {
        if (!cancelled) bumpMaturationConsumers();
        return;
      }

      await refreshTradingRoomSidebarMaturation(combined, dayTradingSurfaces, {
        maxAgeMs: TRADING_ROOM_MATURATION_MAX_AGE_MS,
        maxSymbols: Math.min(combined.length, TRADING_ROOM_MOUNT_MAX_SYMBOLS)
      });
      if (!cancelled) bumpMaturationConsumers();
    })();

    return () => {
      cancelled = true;
    };
  }, [symbolsKey, sidebarSymbols, dayTradingSurfaces]);

  return <WatchlistSessionRefreshOrchestrator dayTradingSurfaces={dayTradingSurfaces} />;
}
