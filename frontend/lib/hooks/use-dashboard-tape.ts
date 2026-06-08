"use client";

import { useMemo } from "react";
import useSWR from "swr";

import type { MarketOverview, MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import { pickUsableVixSnapshot, snapshotHasUsableQuote } from "@/lib/api/market-snapshot-helpers";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const SNAPSHOTS_KEY = `${STOCVEST_SWR_CACHE_NS}dashboard-tape-snapshots` as const;
const STATUS_KEY = `${STOCVEST_SWR_CACHE_NS}dashboard-tape-status` as const;
const INDEX_SYMBOLS = "SPY,QQQ,IWM,I:VIX,^VIX";

function upsertSnapshot(map: Map<string, SnapshotPayload>, snap: SnapshotPayload): void {
  const sym = (snap.symbol || "").trim().toUpperCase();
  if (!sym) return;
  const existing = map.get(sym);
  if (!existing || !snapshotHasUsableQuote(existing)) {
    if (snapshotHasUsableQuote(snap) || snap.last_trade_price != null || snap.day_close != null) {
      map.set(sym, snap);
    }
  }
}

function buildSnapshotMap(
  initial: SnapshotPayload[],
  live: SnapshotPayload[] | undefined,
  vix: SnapshotPayload | null | undefined
): Map<string, SnapshotPayload> {
  const map = new Map<string, SnapshotPayload>();
  for (const snap of initial) upsertSnapshot(map, snap);
  if (live) {
    for (const snap of live) upsertSnapshot(map, snap);
  }
  if (vix?.symbol) {
    upsertSnapshot(map, vix);
  }
  const vixRow = pickUsableVixSnapshot([...map.values()]);
  if (vixRow && "symbol" in vixRow && vixRow.symbol) {
    upsertSnapshot(map, vixRow as SnapshotPayload);
  }
  return map;
}

async function fetchIndexSnapshots(): Promise<SnapshotPayload[]> {
  const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(INDEX_SYMBOLS)}`, {
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return [];
  const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
  return Array.isArray(json.snapshots) ? json.snapshots : [];
}

async function fetchVixSnapshot(): Promise<SnapshotPayload | null> {
  const res = await fetch("/api/stocvest/market/vix-snapshot", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { snapshot?: SnapshotPayload | null };
  return json.snapshot ?? null;
}

async function fetchMarketStatus(): Promise<MarketStatusPayload | null> {
  const res = await fetch("/api/stocvest/market/status", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  try {
    return (await res.json()) as MarketStatusPayload;
  } catch {
    return null;
  }
}

/**
 * Client-side refresh of index tape + market status. Server RSC may paint with empty
 * snapshots when cold Lambdas 5xx on first load; this hook backfills SPY/QQQ/IWM/VIX
 * and session status via same-origin BFF proxies.
 */
export function useDashboardTape(marketOverview: MarketOverview) {
  const { data: liveSnapshots, isLoading: snapshotsLoading } = useSWR(
    [SNAPSHOTS_KEY] as const,
    fetchIndexSnapshots,
    { revalidateOnFocus: false, refreshInterval: 60_000, dedupingInterval: 15_000 }
  );

  const { data: liveVix } = useSWR([`${SNAPSHOTS_KEY}:vix`] as const, fetchVixSnapshot, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    dedupingInterval: 15_000
  });

  const { data: liveStatus } = useSWR([STATUS_KEY] as const, fetchMarketStatus, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    dedupingInterval: 30_000
  });

  const snapshotsBySymbol = useMemo(
    () => buildSnapshotMap(marketOverview.snapshots, liveSnapshots, liveVix),
    [marketOverview.snapshots, liveSnapshots, liveVix]
  );

  const status = liveStatus ?? marketOverview.status ?? null;

  return {
    snapshotsBySymbol,
    status,
    isTapeLoading: snapshotsLoading && snapshotsBySymbol.size === 0
  };
}
