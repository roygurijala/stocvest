"use client";

import { useEffect, useState } from "react";
import { formatWatchlistMaturationDisplayLine } from "@/lib/alignment-display-tier";
import {
  normalizeWatchlistMaturationBySymbol,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { useDefaultWatchlistMembership } from "@/lib/watchlist-membership-client";

export type WatchlistMaturationLine = {
  label: string;
  evaluatedAt: string | null;
  state?: string;
  layersAligned?: number;
  layersTotal?: number;
  readinessLabel?: string;
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

  return buildWatchlistMaturationLine(row, isOnList && Boolean(symU));
}

/** Pure builder for tests and the hook. */
export function buildWatchlistMaturationLine(
  row: WatchlistMaturationRow | undefined,
  onList: boolean
): WatchlistMaturationLine | null {
  if (!onList) return null;
  const display = formatWatchlistMaturationDisplayLine(row);
  const evaluatedAt =
    typeof row?.last_evaluated_at === "string" && row.last_evaluated_at.trim()
      ? row.last_evaluated_at.trim()
      : null;
  const base = {
    state: row?.state,
    layersAligned: row?.layers_aligned,
    layersTotal: row?.layers_total,
    readinessLabel: row?.readiness_label
  };
  if (!display) return { label: "On watchlist", evaluatedAt, ...base };
  return { label: display, evaluatedAt, ...base };
}
