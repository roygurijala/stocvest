/**
 * Watchlist card sort modes — persisted in localStorage, applied within attention tiers.
 */

import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const WATCHLIST_SORT_STORAGE_KEY = "stocvest.watchlist.sort";

export type WatchlistSortMode = "attention" | "alphabetical" | "most_aligned" | "recently_evaluated";

export const WATCHLIST_SORT_OPTIONS: { value: WatchlistSortMode; label: string; hint: string }[] = [
  {
    value: "attention",
    label: "Attention",
    hint: "Within each group: highest alignment, then recently improved, then A→Z"
  },
  { value: "alphabetical", label: "A → Z", hint: "Ticker A→Z within each group" },
  {
    value: "most_aligned",
    label: "Most aligned",
    hint: "Highest layer count first within each group, then A→Z"
  },
  {
    value: "recently_evaluated",
    label: "Recently evaluated",
    hint: "Newest desk evaluation first within each group, then A→Z"
  }
];

/** Short lines for the watchlist “How ordering works” explainer. */
export const WATCHLIST_TIER_GROUPING_LINES = [
  "Check now — 4–6 of 6 layers aligned (includes 5/6 Strong and 6/6); worth opening on Signals.",
  "Getting close — 2–3 layers aligned; building toward the threshold.",
  "Tracking — 0–1 layers; lower priority today."
] as const;

/** Active sort-mode detail, including the equal-score tie case (e.g. many symbols at 5/6). */
export function watchlistSortModeDetail(mode: WatchlistSortMode): string {
  switch (mode) {
    case "alphabetical":
      return "Cards sort by ticker A→Z inside each group above. Group membership does not change.";
    case "most_aligned":
      return "Inside each group: highest layer count first, then A→Z. Equal counts (e.g. ten symbols all at 5/6) sort A→Z.";
    case "recently_evaluated":
      return "Inside each group: most recently evaluated desk run first, then A→Z.";
    case "attention":
    default:
      return "Inside each group: highest layer count first, then symbols that improved since the last evaluation, then A→Z. When many share the same score (e.g. all 5/6), recently improved appear first — the rest are A→Z.";
  }
}

export function watchlistSortModeHint(mode: WatchlistSortMode): string {
  return WATCHLIST_SORT_OPTIONS.find((o) => o.value === mode)?.hint ?? WATCHLIST_SORT_OPTIONS[0].hint;
}

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
