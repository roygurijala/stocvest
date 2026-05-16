"use client";

import { useEffect, useState } from "react";
import {
  formatWatchlistMaturationLabel,
  normalizeWatchlistMaturationBySymbol,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { useDefaultWatchlistMembership } from "@/lib/watchlist-membership-client";

export type WatchlistMaturationLine = {
  label: string;
  evaluatedAt: string | null;
};

/** Maturation row for the active desk on the Signals command bar. */
export function useWatchlistMaturationLine(
  symbol: string,
  tradingMode: "day" | "swing",
  dualDeskTracking: boolean
): WatchlistMaturationLine | null {
  const symU = symbol.trim().toUpperCase();
  const { isOnList } = useDefaultWatchlistMembership(symbol, dualDeskTracking);
  const [row, setRow] = useState<WatchlistMaturationRow | undefined>();

  useEffect(() => {
    if (!symU || !isOnList) {
      setRow(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(tradingMode)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = await res.json().catch(() => ({}));
        const map = normalizeWatchlistMaturationBySymbol(json);
        if (!cancelled) setRow(map[symU]);
      } catch {
        if (!cancelled) setRow(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symU, isOnList, tradingMode]);

  if (!isOnList || !symU) return null;
  const label = formatWatchlistMaturationLabel(row);
  if (label === "—") return { label: "On watchlist", evaluatedAt: null };
  return { label, evaluatedAt: null };
}
