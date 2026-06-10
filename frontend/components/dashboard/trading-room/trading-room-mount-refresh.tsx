"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";
import { WatchlistSessionRefreshOrchestrator } from "@/components/watchlists/watchlist-session-refresh-orchestrator";
import { WATCHLIST_MATURATION_UPDATED_EVENT } from "@/lib/watchlist-maturation-bump";
import {
  fetchDefaultWatchlistSymbols,
  refreshTradingRoomSidebarMaturation,
  TRADING_ROOM_MOUNT_MAX_SYMBOLS
} from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";

type Props = {
  dayTradingSurfaces: boolean;
  /** Symbols visible in the signal feed — refreshed when the list first loads or changes. */
  sidebarSymbols: string[];
};

function bumpMaturationConsumers(): void {
  window.dispatchEvent(new CustomEvent(WATCHLIST_MATURATION_UPDATED_EVENT));
}

/**
 * Trading-room mount hook-up: revalidate desk payloads, refetch maturation-summary,
 * run session-stale composite refresh (orchestrator), and re-composite feed + watchlist
 * symbols on every page load (not gated by the periodic TTL).
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
        maxAgeMs: 0,
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
