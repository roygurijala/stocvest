/**
 * SWR-backed `GET /api/stocvest/signals/position/candidates` for the invest home
 * (ADR-004 POS-D13 / POS-D15). Fetches the ranked gem-candidate screen for a tier.
 *
 * A cold mid-cap + curated compose cannot run inside the API Gateway 29s window, so
 * the backend serves `{ pending: true }` and recomputes in the background. This hook
 * kicks `?refresh=1` once (shared across mount sites), then polls the plain GET until
 * a snapshot arrives. A long compose is still "scanning", not unavailable.
 */
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";

import {
  isPositionScanPending,
  parsePositionCandidates,
  type PositionCandidatesResponse,
  type PositionGemTierFilter
} from "@/lib/dashboard/position-ranked-home-present";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const POLL_MS = 2_500;
/** Soft "still scanning" copy — Lambda timeout is 180s; do not treat this as failure. */
export const POSITION_SCAN_STILL_SCANNING_MS = 165_000;

let inFlightKick: Promise<void> | null = null;

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

function kickPositionScanRefresh(
  tier: PositionGemTierFilter,
  limit: number,
  { force = false }: { force?: boolean } = {}
): void {
  if (inFlightKick && !force) return;
  inFlightKick = (async () => {
    const qs = new URLSearchParams({ tier, limit: String(limit), refresh: "1" });
    await fetch(`/api/stocvest/signals/position/candidates?${qs.toString()}`, {
      method: "GET",
      credentials: "same-origin"
    }).catch(() => null);
  })().finally(() => {
    inFlightKick = null;
  });
}

export interface UsePositionCandidatesResult {
  response: PositionCandidatesResponse | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  isPending: boolean;
  timedOut: boolean;
  error: unknown;
  refresh: () => void;
}

export function usePositionCandidates(
  tier: PositionGemTierFilter,
  options: { limit?: number; enabled?: boolean } = {}
): UsePositionCandidatesResult {
  const { limit = 50, enabled = true } = options;
  const key = enabled ? ([`${STOCVEST_SWR_CACHE_NS}position-candidates`, tier, limit] as const) : null;
  const [timedOut, setTimedOut] = useState(false);
  const { data, isLoading, isValidating, error, mutate } = useSWR(
    key,
    async ([, t, l]: readonly [string, PositionGemTierFilter, number]) => fetchPositionCandidates(t, l),
    { keepPreviousData: false }
  );
  const pending = isPositionScanPending(data ?? null);

  useEffect(() => {
    if (!pending) return;
    kickPositionScanRefresh(tier, limit);
  }, [pending, tier, limit]);

  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const interval = setInterval(() => {
      void mutate();
    }, POLL_MS);
    const stop = setTimeout(() => setTimedOut(true), POSITION_SCAN_STILL_SCANNING_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [pending, mutate]);

  const refresh = useCallback(() => {
    kickPositionScanRefresh(tier, limit, { force: true });
    setTimedOut(false);
    void mutate();
  }, [tier, limit, mutate]);

  return {
    response: data ?? null,
    isInitialLoading: isLoading || pending,
    isRevalidating: isValidating && !isLoading,
    isPending: pending,
    timedOut,
    error,
    refresh
  };
}
