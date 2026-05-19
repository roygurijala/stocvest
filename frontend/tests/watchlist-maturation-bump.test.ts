import { afterEach, describe, expect, test, vi } from "vitest";
import {
  consumeWatchlistMaturationBump,
  notifyWatchlistMaturationUpdated,
  WATCHLIST_MATURATION_UPDATED_EVENT
} from "@/lib/watchlist-maturation-bump";

describe("watchlist-maturation-bump", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  test("notify + consume round-trip", () => {
    notifyWatchlistMaturationUpdated("amzn", "swing");
    expect(consumeWatchlistMaturationBump()).toBe(true);
    expect(consumeWatchlistMaturationBump()).toBe(false);
  });

  test("dispatches window event", () => {
    const handler = vi.fn();
    window.addEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, handler);
    notifyWatchlistMaturationUpdated("AAPL", "day");
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, handler);
  });
});
