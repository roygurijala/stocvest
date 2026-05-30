"use client";

import { useEffect, useRef } from "react";
import { refreshStaleWatchlistMaturation } from "@/lib/watchlist-maturation-session-refresh";
import type { WatchlistMaturationDesk } from "@/lib/watchlist-maturation-session-staleness";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export function useWatchlistSessionRefresh(opts: {
  enabled: boolean;
  symbols: string[];
  swingBySymbol: Record<string, WatchlistMaturationRow>;
  dayBySymbol?: Record<string, WatchlistMaturationRow>;
  desks: WatchlistMaturationDesk[];
  maturationReady: boolean;
  onRefreshed?: () => void;
}): void {
  const {
    enabled,
    symbols,
    swingBySymbol,
    dayBySymbol,
    desks,
    maturationReady,
    onRefreshed
  } = opts;
  const onRefreshedRef = useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;
  const runKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !maturationReady || symbols.length === 0 || desks.length === 0) return;
    const runKey = `${symbols.join(",")}|${desks.join(",")}`;
    if (runKeyRef.current === runKey) return;
    runKeyRef.current = runKey;

    let cancelled = false;
    void (async () => {
      const result = await refreshStaleWatchlistMaturation({
        symbols,
        swingBySymbol,
        dayBySymbol: dayBySymbol ?? {},
        desks
      });
      if (cancelled || !result?.refreshed?.length) return;
      onRefreshedRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, symbols, swingBySymbol, dayBySymbol, desks, maturationReady]);
}
