/**
 * One background revalidation when the Signals page first commits a symbol.
 *
 * Ensures F5 / session restore can refresh cached payloads without racing mode
 * toggles (mode changes already get a new SWR key + fetch). Uses
 * `mutate(key, undefined, { revalidate: true })` — never `null`.
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
  const didRevalidateRef = useRef(false);
  const [isMountRevalidating, setIsMountRevalidating] = useState(false);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!enabled || !sym || didRevalidateRef.current) return;

    didRevalidateRef.current = true;
    let cancelled = false;
    setIsMountRevalidating(true);

    const keys = [compositeKey(sym, mode), snapshotKey(sym), gapIntelKey(sym, mode)] as const;

    // Defer so the SWR hooks' initial subscribe fetch runs first — avoids
    // aborting an in-flight composite request on mode-toggle tests and first paint.
    const timer = window.setTimeout(() => {
      void Promise.all(keys.map((key) => mutate(key, undefined, { revalidate: true }))).finally(() => {
        if (!cancelled) setIsMountRevalidating(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [symbol, mode, enabled, mutate]);

  return { isMountRevalidating };
}
