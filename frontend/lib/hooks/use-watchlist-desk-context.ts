"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { fetchDeskToday, type DeskTodayMode } from "@/lib/api/desk-today";
import type { SnapshotPayload } from "@/lib/api/market";
import type { WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar-attention";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";
import { regimeFromSpyQqq } from "@/lib/market-context/regime";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const BENCHMARK_KEY = `${STOCVEST_SWR_CACHE_NS}watchlist-benchmark-snapshots` as const;

function sessionChangePct(snapshot: SnapshotPayload | undefined): number | null {
  if (!snapshot) return null;
  const c = snapshot.change_percent;
  if (typeof c === "number" && Number.isFinite(c) && c > -99) return c;
  const last = snapshot.last_trade_price;
  const prev = snapshot.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return ((last - prev) / prev) * 100;
  }
  return null;
}

/** Desk quiet when Opportunity Desk cache has no movers or discovery leaders. */
export function inferWatchlistSystemSuppressed(
  deskData: { discovery?: unknown; movers_radar?: unknown } | null | undefined
): boolean {
  const discovery = deskData?.discovery;
  const movers = deskData?.movers_radar;
  const hasDiscovery = Array.isArray(discovery) && discovery.length > 0;
  const hasMovers = Array.isArray(movers) && movers.length > 0;
  return !hasDiscovery && !hasMovers;
}

/**
 * Regime + desk suppression for watchlist decision cards (mirrors dashboard Watchlist radar).
 */
export function useWatchlistDeskContext(planMode: DeskTodayMode): WatchlistRadarDeskContext {
  const { data: deskResponse } = useSWR(deskTodayKey(planMode), async ([, m]) => fetchDeskToday(m), {
    revalidateOnFocus: false
  });

  const { data: benchmarkSnaps } = useSWR(
    BENCHMARK_KEY,
    async () => {
      const res = await fetch("/api/stocvest/market/snapshots?symbols=SPY,QQQ", { cache: "no-store" });
      if (!res.ok) return [] as SnapshotPayload[];
      const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
      return Array.isArray(json.snapshots) ? json.snapshots : [];
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  return useMemo(() => {
    const bySym = new Map(
      (benchmarkSnaps ?? []).map((s) => [(s.symbol || "").trim().toUpperCase(), s] as const)
    );
    const spyPct = sessionChangePct(bySym.get("SPY"));
    const qqqPct = sessionChangePct(bySym.get("QQQ"));
    const regimeLabel = regimeFromSpyQqq(spyPct, qqqPct, "Neutral");
    const systemSuppressed = inferWatchlistSystemSuppressed(deskResponse?.data ?? null);
    return { regimeLabel, systemSuppressed };
  }, [benchmarkSnaps, deskResponse?.data]);
}
