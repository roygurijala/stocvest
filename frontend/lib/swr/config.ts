/**
 * Shared SWR configuration for the STOCVEST frontend.
 *
 * Tier 1 → Layer 4 (see `docs/PERFORMANCE.md` §1 layer 4 + §4C).
 *
 * One file, two exports — the default `SWRConfiguration` object and
 * the `STOCVEST_SWR_CACHE_NS` namespace. Both live here rather than
 * inline in `provider.tsx` so they can be imported from tests
 * without pulling React into the test runtime.
 *
 * Defaults rationale (each value is load-bearing — change with
 * intent, lock-in tests in `tests/swr-config.test.ts` pin them):
 *
 *   * `revalidateOnFocus: false` — STOCVEST's data isn't tick-by-
 *     tick. Refetching every time the user alt-tabs back to the
 *     browser would burn API budget without adding signal. Manual
 *     `mutate()` calls cover the "I want fresh data NOW" path.
 *
 *   * `revalidateOnReconnect: true` — opposite case: when a
 *     network blip ends, refetching cached views once is cheap and
 *     prevents the user from acting on stale data after a hotel
 *     wifi reconnect.
 *
 *   * `dedupingInterval: 30_000` — 30 seconds is the sweet spot
 *     for our use case. Symbol-keyed reads (snapshot, news) update
 *     intra-day but not every second; 30s deduping means rapid
 *     clicks across the dashboard ribbon don't fan out to N
 *     network calls for the same symbol. If a surface needs fresh
 *     data sooner it overrides per-hook (e.g. composite
 *     fetch on mode-toggle).
 *
 *   * `errorRetryCount: 1` — retry exactly once. Server-side our
 *     Lambdas are mostly stateless and a 5xx is usually a code
 *     issue, not a flake. Retrying 3+ times (the SWR default)
 *     just makes the user wait longer to see the error.
 *
 *   * `keepPreviousData: true` — when the user switches symbols
 *     (e.g. ribbon click), keep showing the previous symbol's
 *     snapshot until the new one resolves instead of flashing a
 *     blank state. The hook caller is responsible for not
 *     painting STALE data as if it were fresh — see
 *     `useSymbolSnapshot` for the wrapper that exposes
 *     `isPreviousData` so the UI can render a subtle "refreshing"
 *     indicator instead of confusing data swap.
 *
 *   * `shouldRetryOnError: (err) => boolean` — never retry on a
 *     401, because 401 means the session expired and the
 *     authentication-error helper has already surfaced the banner.
 *     Retrying would re-fire the same 401 and re-surface the
 *     banner, which is annoying.
 */

import type { SWRConfiguration } from "swr";

/**
 * Cache namespace prefix used by every typed hook below. Prefixing
 * keys keeps STOCVEST cache entries from colliding with future
 * SWR-based libraries we might pull in (e.g. an auth provider with
 * its own cache).
 */
export const STOCVEST_SWR_CACHE_NS = "stocvest:";

export const STOCVEST_SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 30_000,
  errorRetryCount: 1,
  keepPreviousData: true,
  shouldRetryOnError(err): boolean {
    // The fetcher in `lib/swr/fetcher.ts` throws a typed
    // `SwrFetcherError` whose `.status` carries the upstream HTTP
    // status. 401s are session-expiry — see
    // `lib/auth/surface-auth-error.ts` which has already kicked
    // off the banner. Retrying here would re-fire the 401 and
    // double-surface the banner.
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status?: unknown }).status === 401
    ) {
      return false;
    }
    return true;
  }
};
