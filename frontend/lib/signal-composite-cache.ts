"use client";

import { mutate } from "swr";

import { getCompositeTransportError } from "@/lib/api/composite-transport";
import type { SignalCompositeMode, SignalCompositeResult } from "@/lib/hooks/use-signal-composite";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export function signalCompositeCacheKey(
  symbol: string,
  mode: SignalCompositeMode
): readonly [string, string, SignalCompositeMode] | null {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  return [`${STOCVEST_SWR_CACHE_NS}signal-composite`, sym, mode] as const;
}

/** After a watchlist Refresh POST, seed SWR so Scenario Builder / layer previews match the new run. */
export async function primeSignalCompositeCache(
  symbol: string,
  mode: SignalCompositeMode,
  data: SignalCompositeResult
): Promise<void> {
  const key = signalCompositeCacheKey(symbol, mode);
  if (!key || getCompositeTransportError(data) || String(data.error ?? "").trim()) return;
  await mutate(key, data, { revalidate: false });
}

export async function revalidateSignalCompositeCache(
  symbol: string,
  mode: SignalCompositeMode
): Promise<void> {
  const key = signalCompositeCacheKey(symbol, mode);
  if (!key) return;
  await mutate(key, undefined, { revalidate: true });
}
