/**
 * Shared SWR fetcher. Wraps `fetch` with the same auth / error
 * conventions the existing imperative fetchers in `lib/api/`
 * already follow, so converting a callsite to SWR is a one-line
 * change rather than a behaviour rewrite.
 *
 * Tier 1 → Layer 4 (see `docs/PERFORMANCE.md` §1 layer 4 + §4C).
 *
 * Two surfaces exported:
 *
 *   1. `swrFetcher(input, init?)` — default fetcher you pass into
 *      `useSWR(key, swrFetcher)`. Throws `SwrFetcherError` on any
 *      non-2xx; SWR catches this and threads it to the hook's
 *      `error` slot.
 *
 *   2. `SwrFetcherError` — typed error class carrying the upstream
 *      HTTP status + the parsed body if available. Used by the
 *      `shouldRetryOnError` predicate in `swr/config.ts` to skip
 *      retries on 401 (session expiry).
 *
 * What this fetcher does NOT do:
 *
 *   * It does NOT swallow non-2xx into `null`. The existing
 *     imperative fetchers (e.g. `fetchSymbolSnapshot`) collapse
 *     errors to `null`, which means SWR cannot distinguish "no
 *     data yet" from "fetch failed". Surfacing errors via thrown
 *     `SwrFetcherError` is the SWR-native pattern and unlocks
 *     proper loading / error UI.
 *
 *   * It does NOT cache anything itself — that's SWR's job.
 *
 *   * It does NOT include the Cognito JWT in the Authorization
 *     header. The BFF routes under `/api/stocvest/*` work off
 *     HttpOnly cookies (`credentials: "include"`), which is the
 *     correct pattern for browser fetches in a Next.js BFF setup.
 *     Direct upstream calls (e.g. to the API Gateway base URL)
 *     remain in `lib/api/*` and keep their existing bearer-token
 *     logic; SWR-wrapped reads in this PR target BFF routes only.
 */

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

export class SwrFetcherError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "SwrFetcherError";
    this.status = status;
    this.body = body;
  }
}

/**
 * SWR's default key type is `string | unknown[]`. We narrow to
 * "string URL" for now because every Layer-4 hook in this PR
 * fetches a single URL. When we add multi-argument hooks (e.g. a
 * combined snapshot+news fetch) we'll switch this to accept arrays
 * — that's a non-breaking extension.
 */
export async function swrFetcher<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {})
    }
  });
  if (response.status === 401) {
    // Surface the session-expired banner if the helper detects
    // an auth error. We still throw below — SWR needs the error
    // to populate the hook's `error` slot.
    void surfaceAuthErrorIfAny(response);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Body wasn't JSON or empty — leave null. The status code
      // is the primary diagnostic.
    }
    throw new SwrFetcherError(
      `Request to ${input} failed: ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }
  return (await response.json()) as T;
}
