import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchDashboardData, isStale, isValidStateVersion } from "@/lib/api/dashboard";

describe("dashboard cache envelope", () => {
  test("test_stale_detection_on_expired_ttl", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(
      isStale({
        state_version: "swing_2026_05_07",
        computed_at: tenMinAgo,
        market_date: "2026-05-07",
        ttl_seconds: 300,
        data: {}
      })
    ).toBe(true);
  });

  test("test_fresh_detection_within_ttl", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(
      isStale({
        state_version: "swing_2026_05_07",
        computed_at: oneMinAgo,
        market_date: "2026-05-07",
        ttl_seconds: 300,
        data: {}
      })
    ).toBe(false);
  });

  test("test_stale_when_envelope_null", () => {
    expect(isStale(null)).toBe(true);
    expect(isStale(undefined)).toBe(true);
  });

  test("test_invalid_state_version_is_stale", () => {
    expect(
      isStale({
        state_version: "bogus",
        computed_at: new Date().toISOString(),
        market_date: "2026-05-07",
        ttl_seconds: 300,
        data: {}
      })
    ).toBe(true);
  });

  test("test_state_version_pattern", () => {
    expect(isValidStateVersion("swing_2026_05_07")).toBe(true);
    expect(isValidStateVersion("day_2026_05_07_10_35")).toBe(true);
    expect(isValidStateVersion("invalid")).toBe(false);
  });
});

describe("fetchDashboardData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("test_fetch_dashboard_ok", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mode: "swing", served_at: "", source: "edge_cache", swing_signals: null }), {
        status: 200
      })
    );
    const res = await fetchDashboardData("swing");
    expect(res.source).toBe("edge_cache");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("/api/dashboard?mode=swing"), expect.any(Object));
  });
});
