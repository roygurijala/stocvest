/**
 * `useSignalComposite(symbol, mode, options)` — SWR-backed read of
 * the composite-signal payload for a (symbol, trading-mode) pair.
 *
 * Tier 1 → Layer 4 second slice (see `docs/PERFORMANCE.md` §4C +
 * the second-slice scope note in §1 layer 4).
 *
 * Why this exists:
 *
 *   Before the second slice, the signals page fired a fresh POST to
 *   `/api/stocvest/signals/composite/{swing|real}` on every effect
 *   re-run of `[symbol, tab, tradingMode]` (see the imperative
 *   `useEffect` previously at `components/signals-page-client.tsx`
 *   ~L1010). Re-clicking the same ribbon chip, toggling between
 *   the Layers / History tabs, or bouncing between mode pills meant
 *   N round trips for the same `(symbol, mode)` pair. SWR fixes
 *   that: identical `(symbol, mode)` keys within the
 *   `dedupingInterval` (30s by default) reuse the cached payload;
 *   genuine key changes still re-fetch.
 *
 * Cache key shape:
 *
 *   `["stocvest:signal-composite", upperCaseSymbol, "swing" | "day"]`
 *   The mode is part of the key so a swing-engine composite for
 *   AAPL never aliases the day-engine composite for AAPL — Mode
 *   Separation invariant (`docs/PERFORMANCE.md` cross-cutting
 *   invariant #5) survives the cache layer.
 *
 *   Empty / whitespace symbol → `null` key → SWR skips the fetch.
 *   The caller decides when to suspend (e.g. on a non-Layers tab)
 *   via the `enabled` option.
 *
 * Why `keepPreviousData: false` overrides the global default:
 *
 *   The signals page has an explicit user-requested invariant: the
 *   6-Layer Breakdown, Radar, Evidence, History rows, and After-
 *   Hours panel MUST clear synchronously when the user toggles the
 *   Swing / Day pill — otherwise the new mode's pill renders next
 *   to the old mode's data, which the user reported as confusing.
 *   The global SWR default of `keepPreviousData: true` would re-
 *   introduce that exact bug for the composite payload. We opt out
 *   for THIS hook only; other hooks keep the default.
 *
 * Behaviour contract (locked in by `tests/use-signal-composite.test.tsx`):
 *
 *   * Identical (symbol, mode) within `dedupingInterval` → fetcher
 *     called once.
 *   * Empty / whitespace / disabled → fetcher never called.
 *   * `enabled: false` produces a null key (SWR skip).
 *   * Mode flip (swing → day) returns `composite: null` synchronously
 *     until the new fetch resolves — preserves "clear screen on mode
 *     switch" without losing the previous symbol's cache entry.
 *   * Non-2xx, network error, malformed JSON → `composite: null` and
 *     the error is propagated up.
 *   * The "insufficient" envelope (`market_status` only) is returned
 *     verbatim — callers use `isInsufficientCompositeResponse` to
 *     branch the UI.
 *   * Transport envelopes (`error: timeout|upstream_unavailable|…`)
 *     surface via `transportError` while `composite` stays null.
 */

import useSWR from "swr";

import {
  compositeFetchErrorMessage,
  getCompositeTransportError,
  type CompositeTransportError
} from "@/lib/api/composite-transport";
import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { notifyWatchlistMaturationUpdated } from "@/lib/watchlist-maturation-bump";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

/** Trading-mode discriminator for the composite endpoint. */
export type SignalCompositeMode = "swing" | "day";

/** Loose record shape; callers narrow it via `isInsufficientCompositeResponse`. */
export type SignalCompositeResult = Record<string, unknown>;

export interface UseSignalCompositeOptions {
  /**
   * When `false`, the hook skips the fetch entirely (null cache
   * key). Use this for tab gating on the signals page — only the
   * Layers tab needs the composite; the History tab reads
   * `signal_history` instead.
   */
  enabled?: boolean;
}

export interface UseSignalCompositeResult {
  composite: SignalCompositeResult | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
  transportError: CompositeTransportError | null;
  fetchErrorMessage: string | null;
}

interface FetchCompositeOptions {
  signal?: AbortSignal;
}

/**
 * POSTs `{ symbol }` to the mode-appropriate composite endpoint and
 * returns the parsed JSON. Throws on non-2xx so SWR routes it
 * through the error slot. The signals page's pre-Layer-4 inline
 * `try/catch` collapsed every failure to `null`; we preserve that
 * UX via the `composite` getter below (returns `null` on error),
 * but still expose `error` so future telemetry can wire onto it.
 */
async function fetchSignalComposite(
  symbol: string,
  mode: SignalCompositeMode,
  opts: FetchCompositeOptions = {}
): Promise<SignalCompositeResult> {
  const path =
    mode === "swing"
      ? "/api/stocvest/signals/composite/swing"
      : "/api/stocvest/signals/composite/real";
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol }),
    credentials: "same-origin",
    signal: opts.signal
  });
  if (!response.ok) {
    throw new Error(
      `Composite request to ${path} failed: ${response.status} ${response.statusText}`
    );
  }
  const body = (await response.json()) as SignalCompositeResult;
  if (
    !getCompositeTransportError(body) &&
    !isInsufficientCompositeResponse(body) &&
    !String(body.error ?? "").trim() &&
    Array.isArray(body.layers)
  ) {
    notifyWatchlistMaturationUpdated(symbol.trim().toUpperCase(), mode);
  }
  return body;
}

export function useSignalComposite(
  symbol: string,
  mode: SignalCompositeMode,
  options: UseSignalCompositeOptions = {}
): UseSignalCompositeResult {
  const { enabled = true } = options;
  const normalized = symbol.trim().toUpperCase();

  const key: readonly [string, string, SignalCompositeMode] | null =
    enabled && normalized
      ? ([`${STOCVEST_SWR_CACHE_NS}signal-composite`, normalized, mode] as const)
      : null;

  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async ([, sym, md]: readonly [string, string, SignalCompositeMode]) =>
      fetchSignalComposite(sym, md),
    {
      /* Mode-switch clear UX — see header docstring. */
      keepPreviousData: false
    }
  );

  const transportError = getCompositeTransportError(data);
  const hasLayerPayload =
    data != null && !transportError && !error && !String(data.error ?? "").trim();

  return {
    composite: hasLayerPayload ? data : null,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error,
    transportError,
    fetchErrorMessage: error ? compositeFetchErrorMessage(error) : null
  };
}

// Re-exported so tests + consumers can wrap it in mocks without
// reaching into a private symbol. Not used by production callers.
export const __internal_fetchSignalComposite = fetchSignalComposite;
