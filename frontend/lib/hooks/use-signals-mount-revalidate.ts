/**
 * One background revalidation per (symbol, trading mode) per page visit.
 *
 * Ensures F5 / session restore triggers a network refresh even when SWR
 * would otherwise serve a deduped cache entry from an earlier navigation
 * in the same tab. Uses `mutate(key, undefined, { revalidate: true })` —
 * never `null`, which would clear cached data and flash an empty UI.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import type { GapIntelMode } from "@/lib/hooks/use-gap-intel";
import type { SignalCompositeMode } from "@/lib/hooks/use-signal-composite";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

function compositeKey(symbol: string, mode: SignalCompositeMode) {
  return [`${STOCVEST_SWR_CACHE_NS}signal-composite`, symbol, mode] as const;
}

function snapshotKey(symbol: string) {
  return [`${STOCVEST_SWR_CACHE_NS}symbol-snapshot`, symbol] as const;
}

function gapIntelKey(symbol: string, mode: GapIntelMode) {
  return [`${STOCVEST_SWR_CACHE_NS}gap-intel`, symbol, mode] as const;
}

export function useSignalsMountRevalidate(
  symbol: string,
  mode: SignalCompositeMode,
  enabled: boolean
): { isMountRevalidating: boolean } {
  const { mutate } = useSWRConfig();
  const revalidatedTokens = useRef(new Set<string>());
  const [isMountRevalidating, setIsMountRevalidating] = useState(false);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!enabled || !sym) return;

    const token = `${sym}:${mode}`;
    if (revalidatedTokens.current.has(token)) return;
    revalidatedTokens.current.add(token);

    let cancelled = false;
    setIsMountRevalidating(true);

    const keys = [compositeKey(sym, mode), snapshotKey(sym), gapIntelKey(sym, mode)] as const;

    void Promise.all(keys.map((key) => mutate(key, undefined, { revalidate: true }))).finally(() => {
      if (!cancelled) setIsMountRevalidating(false);
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, mode, enabled, mutate]);

  return { isMountRevalidating };
}
