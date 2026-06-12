"use client";

import useSWR from "swr";

import { fetchDeskToday, type DeskTodayMode, type DeskTodayResponse } from "@/lib/api/desk-today";
import { deskTodayRefreshIntervalMs } from "@/lib/dashboard/desk-refresh-interval";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export function deskTodayKey(mode: DeskTodayMode): readonly [string, DeskTodayMode] {
  return [`${STOCVEST_SWR_CACHE_NS}desk-today`, mode] as const;
}

type UseDeskTodayOptions = {
  /** Server-prefetched desk payload — shows movers on first paint before client revalidation. */
  fallbackData?: DeskTodayResponse | null;
};

export function useDeskToday(mode: DeskTodayMode, options: UseDeskTodayOptions = {}) {
  const fallbackData = options.fallbackData ?? undefined;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    deskTodayKey(mode),
    async ([, m]: readonly [string, DeskTodayMode]) => fetchDeskToday(m),
    {
      fallbackData,
      refreshInterval: deskTodayRefreshIntervalMs
    }
  );

  return {
    data: data ?? null,
    error,
    isLoading,
    isValidating,
    mutate
  } satisfies {
    data: DeskTodayResponse | null;
    error: unknown;
    isLoading: boolean;
    isValidating: boolean;
    mutate: () => void;
  };
}
