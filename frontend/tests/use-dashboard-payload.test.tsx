/**
 * Tier 1 → Layer 4 (second slice) — `useDashboardPayload` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §4C and
 * `lib/hooks/use-dashboard-payload.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. Happy path → fetcher called with the requested mode.
 *   2. Two hooks for same mode → fetcher called once (SWR dedupe).
 *   3. Different mode → different cache key, fetcher called again.
 *   4. `dashboardPayloadKey` is stable and unique per mode (so a
 *      caller can `mutate(dashboardPayloadKey("day"))` without
 *      duplicating the namespace string).
 *   5. Network error → `data: null` and `error` populated.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const fetcherMock = vi.fn();
vi.mock("@/lib/api/dashboard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/dashboard")>(
    "@/lib/api/dashboard"
  );
  return {
    ...actual,
    fetchDashboardData: (...args: unknown[]) => fetcherMock(...args)
  };
});

import {
  dashboardPayloadKey,
  useDashboardPayload
} from "@/lib/hooks/use-dashboard-payload";

function Provider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false
      }}
    >
      {children}
    </SWRConfig>
  );
}

function DedupeProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 30_000,
        shouldRetryOnError: false
      }}
    >
      {children}
    </SWRConfig>
  );
}

beforeEach(() => {
  fetcherMock.mockReset();
});

afterEach(() => {
  cleanup();
});

const SAMPLE_PAYLOAD = {
  mode: "swing",
  served_at: "2026-05-13T00:00:00Z",
  source: "edge_cache",
  swing_signals: null,
  day_signals: null,
  market_pulse: {
    state_version: "swing_2026_05_13",
    computed_at: new Date().toISOString(),
    market_date: "2026-05-13",
    ttl_seconds: 300,
    data: {}
  },
  sector_rotation: null,
  upcoming_events: null,
  active_positions: null,
  geo_themes: null
} as const;

describe("useDashboardPayload", () => {
  test("happy path → fetcher receives the requested mode and the data is returned", async () => {
    fetcherMock.mockResolvedValue(SAMPLE_PAYLOAD);
    const { result } = renderHook(
      () => useDashboardPayload("swing", { refreshIntervalMs: 0 }),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetcherMock).toHaveBeenCalledWith("swing");
    expect(result.current.data?.source).toBe("edge_cache");
  });

  test("two hooks for same mode → fetcher called once (SWR dedupe)", async () => {
    fetcherMock.mockResolvedValue(SAMPLE_PAYLOAD);
    function PairedHooks() {
      const a = useDashboardPayload("swing", { refreshIntervalMs: 0 });
      const b = useDashboardPayload("swing", { refreshIntervalMs: 0 });
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.data).not.toBeNull());
    expect(result.current.b.data).not.toBeNull();
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  test("different mode → different cache key, fetcher called again", async () => {
    fetcherMock.mockResolvedValue(SAMPLE_PAYLOAD);
    function PairedHooks() {
      const a = useDashboardPayload("swing", { refreshIntervalMs: 0 });
      const b = useDashboardPayload("day", { refreshIntervalMs: 0 });
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.data).not.toBeNull());
    await waitFor(() => expect(result.current.b.data).not.toBeNull());
    expect(fetcherMock).toHaveBeenCalledTimes(2);
    expect(fetcherMock).toHaveBeenNthCalledWith(1, "swing");
    expect(fetcherMock).toHaveBeenNthCalledWith(2, "day");
  });

  test("dashboardPayloadKey returns a stable, mode-discriminated tuple", () => {
    const swing = dashboardPayloadKey("swing");
    const day = dashboardPayloadKey("day");
    // Tuple shape: [namespace, mode].
    expect(swing).toHaveLength(2);
    expect(day).toHaveLength(2);
    expect(swing[0]).toBe(day[0]);
    expect(swing[1]).toBe("swing");
    expect(day[1]).toBe("day");
    // Cache namespace prefix is shared with the rest of the app.
    expect(String(swing[0])).toMatch(/^stocvest:/);
  });

  test("fetcher rejects → data: null and error populated", async () => {
    fetcherMock.mockRejectedValue(new Error("dashboard down"));
    const { result } = renderHook(
      () => useDashboardPayload("swing", { refreshIntervalMs: 0 }),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });
});
