"use client";

import useSWR from "swr";

import { fetchDeskToday, type DeskTodayMode, type DeskTodayResponse } from "@/lib/api/desk-today";
import { DESK_REFRESH_TIER_B_MS, shouldPollDeskTier } from "@/lib/dashboard/desk-refresh-tiers";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export function deskTodayKey(mode: DeskTodayMode): readonly [string, DeskTodayMode] {
  return [`${STOCVEST_SWR_CACHE_NS}desk-today`, mode] as const;
}

export function useDeskToday(mode: DeskTodayMode) {
  const refreshInterval = shouldPollDeskTier("movers") ? DESK_REFRESH_TIER_B_MS : 0;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    deskTodayKey(mode),
    async ([, m]: readonly [string, DeskTodayMode]) => fetchDeskToday(m),
    { refreshInterval }
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
