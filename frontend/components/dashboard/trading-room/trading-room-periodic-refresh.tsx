"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";

import { shouldPollDeskTier } from "@/lib/dashboard/desk-refresh-tiers";
import {
  fetchDefaultWatchlistSymbols,
  refreshTradingRoomSidebarMaturation,
  TRADING_ROOM_MATURATION_MAX_AGE_MS,
  TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS
} from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";
import { WATCHLIST_MATURATION_UPDATED_EVENT } from "@/lib/watchlist-maturation-bump";

type Props = {
  dayTradingSurfaces: boolean;
  /** Symbols in the signal feed — combined with default watchlist on each tick. */
  feedSymbols: string[];
};

/**
 * While the trading room stays open, revalidate desk payloads and re-composite
 * stale feed + watchlist symbols on a fixed interval during RTH.
 */
export function TradingRoomPeriodicRefresh({ dayTradingSurfaces, feedSymbols }: Props) {
  const { mutate } = useSWRConfig();
  const inFlightRef = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        void mutate(deskTodayKey("swing"));
        void mutate(deskTodayKey("day"));

        const watchlistSymbols = await fetchDefaultWatchlistSymbols();
        const combined = [
          ...new Set(
            [...feedSymbols, ...watchlistSymbols].map((s) => s.trim().toUpperCase()).filter(Boolean)
          )
        ];
        if (combined.length === 0) return;

        const result = await refreshTradingRoomSidebarMaturation(combined, dayTradingSurfaces, {
          maxAgeMs: TRADING_ROOM_MATURATION_MAX_AGE_MS,
          maxSymbols: combined.length
        });
        if (result.refreshed.length > 0) {
          window.dispatchEvent(new CustomEvent(WATCHLIST_MATURATION_UPDATED_EVENT));
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const tick = () => {
      if (!shouldPollDeskTier("movers")) return;
      void run();
    };

    const id = window.setInterval(tick, TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [dayTradingSurfaces, feedSymbols, mutate]);

  return null;
}
