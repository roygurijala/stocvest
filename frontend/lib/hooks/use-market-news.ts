/**
 * `useMarketNews()` — broad-market headlines for the Market Intelligence Brief.
 *
 * Reads the no-symbol `/v1/market/news` market-intelligence feed: impact-analyzed,
 * relevance-ranked, publisher-diverse headlines across the liquid tape + the user's
 * watchlist. Each row carries a plain-English `impact_summary`.
 *
 * SWR-cached under a single key so navigating away and back is a cache hit;
 * revalidates quietly in the background.
 */
import useSWR from "swr";

import { fetchMarketHeadlines } from "@/lib/api/fetch-market-headlines";
import type { NewsPayload } from "@/lib/api/market";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const KEY = `${STOCVEST_SWR_CACHE_NS}market-news` as const;

export interface UseMarketNewsResult {
  articles: NewsPayload[];
  isInitialLoading: boolean;
  isRevalidating: boolean;
}

export function useMarketNews(): UseMarketNewsResult {
  const { data, isLoading, isValidating } = useSWR(
    [KEY] as const,
    async () => fetchMarketHeadlines(12),
    { revalidateOnFocus: false }
  );

  return {
    articles: Array.isArray(data) ? data : [],
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading
  };
}
