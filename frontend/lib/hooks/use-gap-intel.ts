/**
 * SWR-backed `GET /api/stocvest/signals/gap-intel` for the active symbol + mode.
 *
 * Uses `keepPreviousData: false` (like `useSignalComposite`) so symbol or mode
 * changes never paint the previous ticker's gap panel while the new fetch runs.
 */

import { useMemo } from "react";
import useSWR from "swr";

import { parseGapIntelSnapshot, type GapIntelSnapshot } from "@/lib/api/gap-intel";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export type GapIntelMode = "swing" | "day";

export interface UseGapIntelOptions {
  enabled?: boolean;
}

async function fetchGapIntel(
  symbol: string,
  mode: GapIntelMode,
  opts: { signal?: AbortSignal } = {}
): Promise<GapIntelSnapshot> {
  const qs = new URLSearchParams({ symbol, trading_mode: mode });
  const res = await fetch(`/api/stocvest/signals/gap-intel?${qs.toString()}`, {
    method: "GET",
    credentials: "same-origin",
    signal: opts.signal
  });
  if (!res.ok) {
    throw new Error(`Gap intel failed: ${res.status} ${res.statusText}`);
  }
  const parsed = parseGapIntelSnapshot(await res.json().catch(() => null));
  if (!parsed) {
    throw new Error("Gap intel response was not a valid snapshot");
  }
  return parsed;
}

export interface UseGapIntelResult {
  snapshot: GapIntelSnapshot | null;
  isInitialLoading: boolean;
  isRevalidating: boolean;
  error: unknown;
}

export function useGapIntel(
  symbol: string,
  mode: GapIntelMode,
  options: UseGapIntelOptions = {}
): UseGapIntelResult {
  const { enabled = true } = options;
  const normalized = symbol.trim().toUpperCase();
  const key: readonly [string, string, GapIntelMode] | null =
    enabled && normalized
      ? ([`${STOCVEST_SWR_CACHE_NS}gap-intel`, normalized, mode] as const)
      : null;

  const { data, isLoading, isValidating, error } = useSWR(
    key,
    async ([, sym, md]: readonly [string, string, GapIntelMode]) => fetchGapIntel(sym, md),
    { keepPreviousData: false }
  );

  const snapshot = useMemo<GapIntelSnapshot | null>(() => {
    if (!data || error) return null;
    if (data.symbol?.toUpperCase() !== normalized) return null;
    return data;
  }, [data, error, normalized]);

  return {
    snapshot,
    isInitialLoading: isLoading,
    isRevalidating: isValidating && !isLoading,
    error
  };
}
