/**
 * `useSymbolNews(symbol, options)` — SWR-backed read of the recent
 * news articles for a ticker, mode-aware.
 *
 * Tier 1 → Layer 4 second slice (see `docs/PERFORMANCE.md` §4C +
 * the second-slice scope note in §1 layer 4).
 *
 * Why this exists:
 *
 *   The pre-Layer-4 signals page fired `fetchSymbolNews` from two
 *   places: (a) the after-hours panel `useEffect` (re-running on
 *   `[showAfterHoursPanel, symbol, tradingMode]`) and (b) the
 *   inline download-evidence handler. Wrapping (a) in SWR makes
 *   the panel cache-hit on repeat opens. (b) stays imperative — it
 *   runs at most once per user-initiated download click, so a
 *   cache layer there adds complexity without benefit.
 *
 *   News also benefits from `keepPreviousData: true` (the global
 *   default): when the user toggles between adjacent symbols on
 *   the same trading-mode pill the previous article list stays on
 *   screen until the new one resolves — no blank-flash.
 *
 * Cache key shape:
 *
 *   `["stocvest:symbol-news", upperCaseSymbol, limit, mode]`
 *
 *   `limit` is part of the key so a call asking for 5 articles
 *   doesn't fight with a call asking for 10. `mode` is part of the
 *   key so day-vs-swing news scopes stay independent — the
 *   upstream `fetchTickerNewsPanel` accepts a `newsTradingMode`
 *   that adjusts the window definition.
 *
 * Behaviour contract (locked in by `tests/use-symbol-news.test.tsx`):
 *
 *   * Identical (symbol, limit, mode) within `dedupingInterval` →
 *     fetcher called once.
 *   * Empty / whitespace symbol → fetcher never called, returns
 *     `articles: []`.
 *   * `enabled: false` disables the fetch entirely (used by the
 *     signals page to gate on `showAfterHoursPanel`).
 *   * Errors collapse to `articles: []` so the panel never shows a
 *     dangling spinner.
 */

import useSWR from "swr";

import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { NewsPayload } from "@/lib/api/market";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export type SymbolNewsMode = "swing" | "day";

export interface UseSymbolNewsOptions {
  /** Article count cap. Mirrors `fetchSymbolNews`'s `limit` arg. Default 5. */
  limit?: number;
  /** News mode discriminator forwarded to the upstream panel. Default `"day"`. */
  mode?: SymbolNewsMode;
  /**
   * When `false`, the hook skips the fetch entirely (null cache
   * key). Used by the signals page's after-hours panel — news is
   * fetched only when the panel is visible.
   */
  enabled?: boolean;
}

export interface UseSymbolNewsResult {
  articles: NewsPayload[];
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
}

export function useSymbolNews(
  symbol: string,
  options: UseSymbolNewsOptions = {}
): UseSymbolNewsResult {
  const { limit = 5, mode = "day", enabled = true } = options;
  const normalized = symbol.trim().toUpperCase();

  const key:
    | readonly [string, string, number, SymbolNewsMode]
    | null = enabled && normalized
    ? ([`${STOCVEST_SWR_CACHE_NS}symbol-news`, normalized, limit, mode] as const)
    : null;

  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async (
      [, sym, lim, md]: readonly [string, string, number, SymbolNewsMode]
    ) => fetchSymbolNews(sym, lim, { newsTradingMode: md })
  );

  return {
    articles: error || !data ? [] : data,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}
