/**
 * `useMacroContext()` — SWR-backed read of `/v1/market/macro-context`.
 *
 * Tier 1 → Layer 4 second slice (see `docs/PERFORMANCE.md` §4C +
 * the second-slice scope note in §1 layer 4).
 *
 * Why this exists:
 *
 *   `DashboardRedesign` fired a one-shot `useEffect` calling
 *   `fetchMacroContext()` on every mount. Every time the user
 *   navigated away from the dashboard and back, a fresh request
 *   went out — even though the macro snapshot (yield curve,
 *   upcoming events, macro_risk) changes on the order of hours
 *   at most. Wrapping this in SWR makes a navigation round-trip
 *   cache-hit and silently revalidates in the background.
 *
 * Cache key shape:
 *
 *   `["stocvest:macro-context"]` — a single tuple slot. The
 *   payload is user-agnostic (same for every authenticated user)
 *   so we deliberately do NOT include user id in the key — that
 *   would defeat dedupe across users on the same browser
 *   (rare but possible).
 *
 * Behaviour contract (locked in by `tests/use-macro-context.test.tsx`):
 *
 *   * Two simultaneous mounts → fetcher called once.
 *   * Network error / 401 → returns `data: null`; `error` slot
 *     populated for telemetry.
 *   * `fetchMacroContext` already swallows non-2xx into `null`;
 *     we surface the same convention for back-compat.
 *
 * Cross-cutting invariant #2 (`docs/PERFORMANCE.md`): this
 * endpoint MUST stay user-agnostic. If a future PR makes it
 * user-personalized, this hook's cache key must add a user-id
 * segment.
 */

import useSWR from "swr";

import {
  fetchMacroContext,
  type MacroContextPayload
} from "@/lib/api/fetch-macro-context";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const KEY = `${STOCVEST_SWR_CACHE_NS}macro-context` as const;

export interface UseMacroContextResult {
  data: MacroContextPayload | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
}

export function useMacroContext(): UseMacroContextResult {
  const { data, isLoading, isValidating, error } = useSWR(
    [KEY] as const,
    async () => fetchMacroContext()
  );

  return {
    data: error || !data ? null : data,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}

/** Stable key so consumers can imperatively `mutate(...)` if a hint arrives. */
export function macroContextKey(): readonly [typeof KEY] {
  return [KEY] as const;
}
