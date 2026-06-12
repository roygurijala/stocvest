import { describe, expect, test } from "vitest";
import {
  deskResponseHasLeaders,
  isDeskCacheMiss,
  isDeskCacheStale
} from "@/lib/dashboard/desk-response";
import type { DeskTodayResponse } from "@/lib/api/desk-today";

describe("desk-response helpers", () => {
  test("isDeskCacheMiss only when source is cache_miss without data", () => {
    expect(isDeskCacheMiss({ mode: "day", source: "cache_miss", data: null })).toBe(true);
    expect(
      isDeskCacheMiss({
        mode: "day",
        source: "cache_stale",
        data: { movers_radar: [{ symbol: "A", gap_percent: 1, direction: "up", rank_score: 1 }] }
      })
    ).toBe(false);
  });

  test("isDeskCacheStale when stale backup has payload", () => {
    expect(
      isDeskCacheStale({
        mode: "day",
        source: "cache_stale",
        data: { discovery: [{ symbol: "A", gap_percent: 1, direction: "up", rank_score: 1, desk: "day" }] }
      })
    ).toBe(true);
  });

  test("deskResponseHasLeaders checks discovery and movers", () => {
    const res: DeskTodayResponse = {
      mode: "day",
      source: "cache",
      data: { movers_radar: [{ symbol: "X", gap_percent: 2, direction: "down", rank_score: 3 }] }
    };
    expect(deskResponseHasLeaders(res)).toBe(true);
    expect(deskResponseHasLeaders({ mode: "day", source: "cache_miss", data: null })).toBe(false);
  });
});
