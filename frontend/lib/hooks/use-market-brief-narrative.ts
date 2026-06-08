/**
 * `useMarketBriefNarrative()` — the AI-written daily market narrative.
 *
 * Reads `GET /v1/market/brief` (user-agnostic, server-cached). SWR-cached under a
 * single key; revalidates quietly. Returns `null` narrative when the endpoint is
 * unavailable (e.g. not yet deployed) so the brief falls back to its deterministic copy.
 */
import useSWR from "swr";

import { fetchMarketBriefNarrative, type MarketBriefNarrative } from "@/lib/api/fetch-market-brief";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const KEY = `${STOCVEST_SWR_CACHE_NS}market-brief-narrative` as const;

export interface UseMarketBriefNarrativeResult {
  data: MarketBriefNarrative | null;
  isInitialLoading: boolean;
}

export function useMarketBriefNarrative(): UseMarketBriefNarrativeResult {
  const { data, isLoading } = useSWR([KEY] as const, async () => fetchMarketBriefNarrative(), {
    revalidateOnFocus: false,
    // The narrative is server-cached per ~10-min window; refresh occasionally.
    refreshInterval: 5 * 60 * 1000
  });

  return {
    data: data ?? null,
    isInitialLoading: isLoading
  };
}
