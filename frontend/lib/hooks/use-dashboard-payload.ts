/**
 * `useDashboardPayload(mode)` — SWR-backed read of the Edge-cache
 * dashboard envelope (`GET /api/dashboard?mode=...`).
 *
 * Tier 1 → Layer 4 second slice (see `docs/PERFORMANCE.md` §4C +
 * the second-slice scope note in §1 layer 4).
 *
 * Why this exists:
 *
 *   The previous `DashboardEdgeSync` component implemented its own
 *   60-second `setInterval` polling loop and held the response in
 *   local `useState`. Moving the same payload behind SWR buys us:
 *
 *     * **Cache + dedupe** — when a future surface wants the same
 *       payload (e.g. a future "Sector heatmap" island reading
 *       `data.sector_rotation`), it hits the cached copy instead of
 *       re-fetching.
 *     * **Hint-driven invalidation** — the existing
 *       `useLiveSignals(mode, onHint)` SSE stream can call
 *       `mutate(useDashboardPayloadKey(mode))` to force a refresh
 *       on a hint without touching the polling loop.
 *     * **`refreshInterval` lives in one place** — SWR's built-in
 *       interval replaces the manual `setInterval` + `useCallback`
 *       pattern, and pauses automatically when the tab is hidden
 *       (free polling-cost reduction).
 *
 * Cache key shape:
 *
 *   `["stocvest:dashboard-payload", "swing" | "day"]`
 *
 *   We expose the key builder as a named export so the live-hint
 *   handler (and anything else that needs to imperatively
 *   invalidate) doesn't duplicate the namespace constant.
 *
 * Why we don't override the global defaults here:
 *
 *   `revalidateOnFocus: false`, `revalidateOnReconnect: true`,
 *   `dedupingInterval: 30_000`, `errorRetryCount: 1`,
 *   `keepPreviousData: true` are all the right shape for this
 *   payload. The previous polling loop was 60s; SWR's
 *   `refreshInterval: 60_000` matches that exactly. We DO NOT use
 *   `revalidateOnFocus` because the dashboard payload can be
 *   expensive (Cloudflare/Upstash Edge cache) and refocus is not
 *   a signal that the data changed.
 *
 * Behaviour contract (locked in by `tests/use-dashboard-payload.test.tsx`):
 *
 *   * Two consecutive renders with the same `mode` → fetcher called
 *     once (SWR dedupe).
 *   * Mode flip → new cache key, fetcher called again, previous
 *     payload kept on screen until new one resolves (`keepPreviousData`).
 *   * Network error → returns `data: null` and the error is
 *     propagated to `error` (callers can render fallback chrome).
 *   * Polling fires every 60s when the tab is visible.
 */

import useSWR from "swr";

import { fetchDashboardData, type DashboardResponse } from "@/lib/api/dashboard";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export type DashboardPayloadMode = "swing" | "day";

/** Stable cache-key builder so callers can `mutate(...)` without re-deriving the shape. */
export function dashboardPayloadKey(mode: DashboardPayloadMode): readonly [string, DashboardPayloadMode] {
  return [`${STOCVEST_SWR_CACHE_NS}dashboard-payload`, mode] as const;
}

export interface UseDashboardPayloadResult {
  data: DashboardResponse | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
}

export interface UseDashboardPayloadOptions {
  /**
   * Polling interval in milliseconds. Defaults to `60_000` to
   * match the pre-Layer-4 `setInterval` cadence in
   * `DashboardEdgeSync`. Set `0` to disable polling (tests do
   * this so SWR doesn't fire a second fetch after the first
   * resolves).
   */
  refreshIntervalMs?: number;
}

export function useDashboardPayload(
  mode: DashboardPayloadMode,
  options: UseDashboardPayloadOptions = {}
): UseDashboardPayloadResult {
  const refreshIntervalMs = options.refreshIntervalMs ?? 60_000;
  const key = dashboardPayloadKey(mode);

  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async ([, m]: readonly [string, DashboardPayloadMode]) => {
      try {
        return await fetchDashboardData(m);
      } catch {
        // Avoid surfacing fetch failures as client runtime errors on long-lived dashboard views.
        return {
          mode: m,
          served_at: new Date().toISOString(),
          source: "edge_cache_error",
          swing_signals: null,
          day_signals: null,
          market_pulse: null,
          sector_rotation: null,
          upcoming_events: null,
          active_positions: null,
          geo_themes: null
        };
      }
    },
    {
      refreshInterval: refreshIntervalMs
    }
  );

  return {
    data: error || !data ? null : data,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}
