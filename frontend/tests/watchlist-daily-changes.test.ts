import { describe, expect, test } from "vitest";
import {
  collectWatchlistDailyChanges,
  summarizeWatchlistDailyChanges
} from "@/lib/dashboard/watchlist-daily-changes";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

describe("watchlist-daily-changes", () => {
  test("summarize improved near-ready symbol", () => {
    const bySymbol: Record<string, WatchlistMaturationRow> = {
      NVDA: {
        symbol: "NVDA",
        layers_aligned: 4,
        layers_total: 6,
        progress_band: "near_ready",
        state: "near_ready",
        last_transition_type: "improved",
        last_transition_detail: "3/6 → 4/6"
      }
    };
    const summary = summarizeWatchlistDailyChanges(bySymbol);
    expect(summary).toMatch(/NVDA/);
    expect(summary).toMatch(/actionable/i);
    expect(collectWatchlistDailyChanges(bySymbol).improved).toContain("NVDA");
  });

  test("summarize weakened symbols", () => {
    const bySymbol: Record<string, WatchlistMaturationRow> = {
      AMD: {
        symbol: "AMD",
        layers_aligned: 2,
        layers_total: 6,
        last_transition_type: "worsened"
      }
    };
    expect(summarizeWatchlistDailyChanges(bySymbol)).toMatch(/lost structure/i);
  });

  test("returns null when no transitions", () => {
    expect(summarizeWatchlistDailyChanges({})).toBeNull();
  });
});
