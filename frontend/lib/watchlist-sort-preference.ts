/**
 * Watchlist card sort modes — persisted in localStorage, applied within attention tiers.
 */

import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const WATCHLIST_SORT_STORAGE_KEY = "stocvest.watchlist.sort";

export type WatchlistSortMode = "attention" | "alphabetical" | "most_aligned" | "recently_evaluated";

export const WATCHLIST_SORT_OPTIONS: { value: WatchlistSortMode; label: string; hint: string }[] = [
  { value: "attention", label: "Attention", hint: "Most urgent first within each group" },
  { value: "alphabetical", label: "A → Z", hint: "Alphabetical by ticker" },
  { value: "most_aligned", label: "Most aligned", hint: "Highest layer count first" },
  { value: "recently_evaluated", label: "Recently evaluated", hint: "Newest desk run first" }
];

export function isWatchlistSortMode(value: string): value is WatchlistSortMode {
  return WATCHLIST_SORT_OPTIONS.some((o) => o.value === value);
}

export function readWatchlistSortMode(): WatchlistSortMode {
  if (typeof window === "undefined") return "attention";
  try {
    const raw = window.localStorage.getItem(WATCHLIST_SORT_STORAGE_KEY);
    if (raw && isWatchlistSortMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "attention";
}

export function writeWatchlistSortMode(mode: WatchlistSortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_SORT_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function evalTimestamp(row: WatchlistMaturationRow | undefined): number {
  const iso = row?.last_evaluated_at?.trim();
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Compare two symbols for ordering inside an attention tier. */
export function compareWatchlistSymbolsBySort(
  a: string,
  b: string,
  sortMode: WatchlistSortMode,
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined
): number {
  const ra = rowForSymbol(a);
  const rb = rowForSymbol(b);

  switch (sortMode) {
    case "alphabetical":
      return a.localeCompare(b);
    case "most_aligned": {
      const ca = maturationAlignmentCounts(ra).aligned;
      const cb = maturationAlignmentCounts(rb).aligned;
      if (cb !== ca) return cb - ca;
      return a.localeCompare(b);
    }
    case "recently_evaluated": {
      const ta = evalTimestamp(ra);
      const tb = evalTimestamp(rb);
      if (tb !== ta) return tb - ta;
      return a.localeCompare(b);
    }
    case "attention":
    default: {
      const ca = maturationAlignmentCounts(ra).aligned;
      const cb = maturationAlignmentCounts(rb).aligned;
      if (cb !== ca) return cb - ca;
      const impA = ra?.last_transition_type === "improved" ? 1 : 0;
      const impB = rb?.last_transition_type === "improved" ? 1 : 0;
      if (impB !== impA) return impB - impA;
      return a.localeCompare(b);
    }
  }
}

export function sortWatchlistSymbolsInTier(
  symbols: string[],
  sortMode: WatchlistSortMode,
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined
): string[] {
  return [...symbols].sort((a, b) => compareWatchlistSymbolsBySort(a, b, sortMode, rowForSymbol));
}
