"use client";

import useSWR from "swr";

import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { useWatchlistMaturationReloadNonce } from "@/lib/hooks/use-watchlist-maturation-reload";
import { TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS } from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";
import { shouldPollDeskTier } from "@/lib/dashboard/desk-refresh-tiers";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const KEY = `${STOCVEST_SWR_CACHE_NS}trading-room-maturation` as const;

async function fetchMaturationBySymbol(mode: "swing" | "day"): Promise<Record<string, WatchlistMaturationRow>> {
  const res = await fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!res.ok) return {};
  const json = await res.json().catch(() => ({}));
  return parseMaturationSummaryEnvelope(json).bySymbol;
}

export function useTradingRoomMaturation(dayTradingSurfaces: boolean): {
  swingBySymbol: Record<string, WatchlistMaturationRow>;
  dayBySymbol: Record<string, WatchlistMaturationRow>;
} {
  const [reloadNonce] = useWatchlistMaturationReloadNonce();

  const refreshInterval = shouldPollDeskTier("movers") ? TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS : 0;

  const { data: swingBySymbol = {} } = useSWR(
    [KEY, "swing", reloadNonce] as const,
    async ([, mode]: readonly [string, "swing", number]) => fetchMaturationBySymbol(mode),
    { revalidateOnFocus: true, refreshInterval }
  );

  const { data: dayBySymbol = {} } = useSWR(
    dayTradingSurfaces ? ([KEY, "day", reloadNonce] as const) : null,
    async ([, mode]: readonly [string, "day", number]) => fetchMaturationBySymbol(mode),
    { revalidateOnFocus: true, refreshInterval }
  );

  return { swingBySymbol, dayBySymbol };
}
