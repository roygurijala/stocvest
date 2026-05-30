"use client";

import { useEffect, useRef } from "react";
import { refreshStaleWatchlistMaturation } from "@/lib/watchlist-maturation-session-refresh";
import type { WatchlistMaturationDesk } from "@/lib/watchlist-maturation-session-staleness";
import { nyTradingDateIso } from "@/lib/watchlist-maturation-session-staleness";
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

  const symbolsKey = symbols.join(",");
  const desksKey = desks.join(",");
  const sessionDate = nyTradingDateIso();

  const swingRef = useRef(swingBySymbol);
  const dayRef = useRef(dayBySymbol ?? {});
  swingRef.current = swingBySymbol;
  dayRef.current = dayBySymbol ?? {};

  const inFlightRef = useRef(false);
  const completedWaveRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !maturationReady || symbols.length === 0 || desks.length === 0) return;

    const waveKey = `${sessionDate}|${symbolsKey}|${desksKey}`;
    if (completedWaveRef.current === waveKey || inFlightRef.current) return;

    inFlightRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const result = await refreshStaleWatchlistMaturation({
          symbols,
          swingBySymbol: swingRef.current,
          dayBySymbol: dayRef.current,
          desks,
          sessionDate
        });
        if (cancelled) return;
        completedWaveRef.current = waveKey;
        if (result.refreshed.length > 0) {
          onRefreshedRef.current?.();
        }
      } finally {
        if (!cancelled) inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, maturationReady, symbolsKey, desksKey, sessionDate, symbols, desks]);
}
