import { describe, expect, test } from "vitest";

import {
  readWatchlistTrackingCompact,
  writeWatchlistTrackingCompact,
  WATCHLIST_TRACKING_COMPACT_STORAGE_KEY
} from "@/lib/watchlist-display-preference";

describe("watchlist display preference", () => {
  test("tracking compact defaults false and persists", () => {
    localStorage.removeItem(WATCHLIST_TRACKING_COMPACT_STORAGE_KEY);
    expect(readWatchlistTrackingCompact()).toBe(false);
    writeWatchlistTrackingCompact(true);
    expect(readWatchlistTrackingCompact()).toBe(true);
    localStorage.removeItem(WATCHLIST_TRACKING_COMPACT_STORAGE_KEY);
  });
});
