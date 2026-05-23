/** Persisted watchlist display toggles (localStorage). */

export const WATCHLIST_TRACKING_COMPACT_STORAGE_KEY = "stocvest.watchlist.tracking_compact";

export function readWatchlistTrackingCompact(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WATCHLIST_TRACKING_COMPACT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWatchlistTrackingCompact(compact: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_TRACKING_COMPACT_STORAGE_KEY, compact ? "1" : "0");
  } catch {
    /* ignore */
  }
}
