import { describe, expect, test } from "vitest";
import {
  deskResponseHasLeaders,
  isDeskCacheMiss,
  isDeskCacheStale,
  swingDeskNeedsDiscoveryRefresh
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

  test("swingDeskNeedsDiscoveryRefresh only when movers tier lacks composite rows", () => {
    const moversOnly: DeskTodayResponse = {
      mode: "swing",
      source: "cache",
      data: {
        tier: "movers",
        movers_radar: [{ symbol: "X", gap_percent: 2, direction: "down", rank_score: 3 }],
        discovery: [],
        quiet_leaders: [],
        developing_setups: []
      }
    };
    expect(swingDeskNeedsDiscoveryRefresh(moversOnly)).toBe(true);

    const fullEmpty: DeskTodayResponse = {
      mode: "swing",
      source: "cache",
      data: {
        tier: "full",
        movers_radar: [{ symbol: "X", gap_percent: 2, direction: "down", rank_score: 3 }],
        discovery: [],
        quiet_leaders: [],
        developing_setups: []
      }
    };
    expect(swingDeskNeedsDiscoveryRefresh(fullEmpty)).toBe(false);

    const developingPresent: DeskTodayResponse = {
      ...moversOnly,
      data: {
        ...moversOnly.data!,
        developing_setups: [{ symbol: "DEV", gap_percent: 1, direction: "up", rank_score: 1, desk: "swing" }]
      }
    };
    expect(swingDeskNeedsDiscoveryRefresh(developingPresent)).toBe(false);
  });
});
