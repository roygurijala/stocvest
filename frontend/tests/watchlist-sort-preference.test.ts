import { describe, expect, test } from "vitest";

import {
  compareWatchlistSymbolsBySort,
  isWatchlistSortMode,
  readWatchlistSortMode,
  writeWatchlistSortMode,
  WATCHLIST_SORT_STORAGE_KEY
} from "@/lib/watchlist-sort-preference";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

function row(partial: Partial<WatchlistMaturationRow>): WatchlistMaturationRow {
  return partial as WatchlistMaturationRow;
}

describe("watchlist sort preference", () => {
  test("isWatchlistSortMode validates known modes", () => {
    expect(isWatchlistSortMode("attention")).toBe(true);
    expect(isWatchlistSortMode("alphabetical")).toBe(true);
    expect(isWatchlistSortMode("bogus")).toBe(false);
  });

  test("read/write round-trips in localStorage", () => {
    localStorage.removeItem(WATCHLIST_SORT_STORAGE_KEY);
    expect(readWatchlistSortMode()).toBe("attention");
    writeWatchlistSortMode("alphabetical");
    expect(readWatchlistSortMode()).toBe("alphabetical");
    localStorage.removeItem(WATCHLIST_SORT_STORAGE_KEY);
  });

  test("compareWatchlistSymbolsBySort alphabetical", () => {
    const rowFor = () => undefined;
    expect(compareWatchlistSymbolsBySort("ZZZ", "AAA", "alphabetical", rowFor)).toBeGreaterThan(0);
  });

  test("compareWatchlistSymbolsBySort recently_evaluated prefers newer", () => {
    const rowFor = (sym: string) =>
      sym === "NEW"
        ? row({ last_evaluated_at: new Date().toISOString() })
        : row({ last_evaluated_at: new Date(Date.now() - 86_400_000).toISOString() });
    expect(compareWatchlistSymbolsBySort("OLD", "NEW", "recently_evaluated", rowFor)).toBeGreaterThan(0);
  });
});
