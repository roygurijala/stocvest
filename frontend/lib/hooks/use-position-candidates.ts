/**
 * SWR-backed `GET /api/stocvest/signals/position/candidates` for the invest home
 * (ADR-004 POS-D13 / POS-D15). Fetches the ranked gem-candidate screen for a tier.
 */
import useSWR from "swr";

import {
  parsePositionCandidates,
  type PositionCandidatesResponse,
  type PositionGemTierFilter
} from "@/lib/dashboard/position-ranked-home-present";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

async function fetchPositionCandidates(
  tier: PositionGemTierFilter,
  limit: number
): Promise<PositionCandidatesResponse> {
  const qs = new URLSearchParams({ tier, limit: String(limit) });
  const res = await fetch(`/api/stocvest/signals/position/candidates?${qs.toString()}`, {
    method: "GET",
    credentials: "same-origin"
  });
  if (!res.ok) {
    throw new Error(`Position candidates failed: ${res.status} ${res.statusText}`);
  }
  const parsed = parsePositionCandidates(await res.json().catch(() => null));
  if (!parsed) {
    throw new Error("Position candidates response was not valid");
  }
  return parsed;
}

export interface UsePositionCandidatesResult {
  response: PositionCandidatesResponse | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
}

export function usePositionCandidates(
  tier: PositionGemTierFilter,
  options: { limit?: number; enabled?: boolean } = {}
): UsePositionCandidatesResult {
  const { limit = 50, enabled = true } = options;
  const key = enabled ? ([`${STOCVEST_SWR_CACHE_NS}position-candidates`, tier, limit] as const) : null;
  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async ([, t, l]: readonly [string, PositionGemTierFilter, number]) => fetchPositionCandidates(t, l),
    { keepPreviousData: false }
  );
  return {
    response: data ?? null,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}
