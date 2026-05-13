/**
 * `useSymbolSnapshot(symbol)` — SWR-backed read of the latest
 * snapshot for a ticker.
 *
 * Tier 1 → Layer 4 (see `docs/PERFORMANCE.md` §1 layer 4 + §4C).
 *
 * Why this exists:
 *
 *   Before Layer 4, the signals page fired a fresh
 *   `fetchSymbolSnapshot(symbol)` on every symbol-change effect.
 *   Switching from AAPL → NVDA → AAPL meant THREE round trips,
 *   not two, because we had no client-side cache. With SWR:
 *
 *     * First view of AAPL → network fetch + cache write.
 *     * Switch to NVDA → network fetch + cache write.
 *     * Back to AAPL → instant render from cache, silent
 *       background refresh.
 *
 *   The hook returns `previousData` while the new symbol is
 *   loading (see `keepPreviousData: true` in `swr/config.ts`),
 *   so the UI doesn't flash a blank state on every chip click.
 *
 * Why wrap the existing imperative fetcher instead of pointing
 * SWR at the URL directly?
 *
 *   `fetchSymbolSnapshot` reads a non-HttpOnly WS token from
 *   `document.cookie` and adds it as a Bearer header. That auth
 *   plumbing is shared with several other call sites that we are
 *   NOT converting in this PR (one-shot fetches inside async
 *   handlers, evidence-modal expansion, etc.). Wrapping keeps
 *   the auth logic in one place — SWR contributes cache + dedupe
 *   + revalidate only.
 *
 * Cache key shape:
 *
 *   `["stocvest:symbol-snapshot", upperCaseSymbol]` — a tuple,
 *   not a string. SWR hashes tuple keys structurally, so we get
 *   automatic per-symbol cache entries without doing string
 *   concatenation ourselves. An empty/whitespace symbol yields a
 *   `null` key, which SWR treats as "skip this request" — that's
 *   the standard SWR pattern for guarded fetches.
 *
 * Behaviour contract (locked in by `tests/use-symbol-snapshot.test.tsx`):
 *
 *   * Identical calls within `dedupingInterval` (30s) hit the
 *     fetcher exactly once.
 *   * Empty / whitespace symbol → fetcher never called, hook
 *     returns `{ snapshot: null, ... }`.
 *   * The mismatch guard (snapshot returned but for a different
 *     ticker — happens when the upstream returns a redirect for
 *     unknown symbols) is preserved from the original effect.
 */

import { useMemo } from "react";
import useSWR from "swr";

import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import type { SnapshotPayload } from "@/lib/api/market";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export interface UseSymbolSnapshotResult {
  /** The latest snapshot for the requested symbol, or `null` if not yet loaded / not available. */
  snapshot: SnapshotPayload | null;
  /** True for the very first fetch on a fresh key (no cache hit). False on subsequent stale-while-revalidate refetches. */
  isInitialLoading: boolean;
  /** True when SWR is silently refreshing a cached entry in the background. UI may show a subtle "refreshing" pip. */
  isRevalidating: boolean;
  /** Thrown fetcher error, if any. `fetchSymbolSnapshot` swallows errors to `null`, so this stays unset for now. */
  error: unknown;
}

export function useSymbolSnapshot(symbol: string): UseSymbolSnapshotResult {
  const normalized = symbol.trim().toUpperCase();
  const key: readonly [string, string] | null = normalized
    ? ([`${STOCVEST_SWR_CACHE_NS}symbol-snapshot`, normalized] as const)
    : null;

  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async ([, sym]: readonly [string, string]) => fetchSymbolSnapshot(sym)
  );

  // Defensive ticker mismatch guard — upstream sometimes returns a
  // snapshot for a different symbol when the query is ambiguous.
  // Preserves the same check the original imperative effect did.
  const snapshot = useMemo<SnapshotPayload | null>(() => {
    if (!data) return null;
    if (data.symbol?.toUpperCase() !== normalized) return null;
    return data;
  }, [data, normalized]);

  return {
    snapshot,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}
