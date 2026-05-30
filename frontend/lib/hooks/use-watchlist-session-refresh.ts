"use client";

import { useEffect, useMemo, useRef } from "react";
import { refreshStaleWatchlistMaturation } from "@/lib/watchlist-maturation-session-refresh";
import {
  collectStaleWatchlistSymbols,
  nyTradingDateIso,
  type WatchlistMaturationDesk
} from "@/lib/watchlist-maturation-session-staleness";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

function maturationEpochKey(
  symbols: string[],
  desks: WatchlistMaturationDesk[],
  swingBySymbol: Record<string, WatchlistMaturationRow>,
  dayBySymbol: Record<string, WatchlistMaturationRow>
): string {
  const parts: string[] = [];
  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    for (const desk of desks) {
      const row = desk === "swing" ? swingBySymbol[sym] : dayBySymbol[sym];
      parts.push(`${sym}:${desk}:${row?.last_evaluated_at ?? ""}`);
    }
  }
  return parts.join("|");
}

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
  const dayMap = dayBySymbol ?? {};

  const staleSignature = useMemo(() => {
    if (!maturationReady || symbols.length === 0 || desks.length === 0) return "";
    const stale = collectStaleWatchlistSymbols(symbols, desks, swingBySymbol, dayMap, sessionDate);
    return stale
      .map((w) => `${w.symbol}:${w.desk}`)
      .sort()
      .join(",");
  }, [maturationReady, symbolsKey, desksKey, sessionDate, swingBySymbol, dayMap, symbols, desks]);

  const maturationEpoch = useMemo(
    () => maturationEpochKey(symbols, desks, swingBySymbol, dayMap),
    [symbolsKey, desksKey, swingBySymbol, dayMap, symbols, desks]
  );

  const swingRef = useRef(swingBySymbol);
  const dayRef = useRef(dayMap);
  swingRef.current = swingBySymbol;
  dayRef.current = dayMap;

  const inFlightRef = useRef(false);
  const lastRunForEpochRef = useRef<string | null>(null);

  useEffect(() => {
    lastRunForEpochRef.current = null;
  }, [staleSignature]);

  useEffect(() => {
    if (!enabled || !maturationReady || !staleSignature) return;
    if (inFlightRef.current) return;
    if (lastRunForEpochRef.current === maturationEpoch) return;

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
        lastRunForEpochRef.current = maturationEpoch;
        onRefreshedRef.current?.();
      } finally {
        if (!cancelled) inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    maturationReady,
    staleSignature,
    maturationEpoch,
    symbolsKey,
    desksKey,
    sessionDate,
    symbols,
    desks
  ]);

  useEffect(() => {
    const resetRetry = () => {
      if (document.visibilityState === "visible") {
        lastRunForEpochRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", resetRetry);
    window.addEventListener("focus", resetRetry);
    return () => {
      document.removeEventListener("visibilitychange", resetRetry);
      window.removeEventListener("focus", resetRetry);
    };
  }, []);
}
