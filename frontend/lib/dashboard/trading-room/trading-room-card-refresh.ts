/**
 * Per-card refresh for the trading room — re-runs composite, desk, and quote data.
 */

import { mutate } from "swr";

import type { SnapshotPayload } from "@/lib/api/market";
import { deskTodayKey } from "@/lib/hooks/use-desk-today";
import { revalidateSignalCompositeCache } from "@/lib/signal-composite-cache";
import { refreshWatchlistSymbolMaturationDesk } from "@/lib/watchlist-maturation-prime";

import type { FeedLane } from "./feed-model";

export const TRADING_ROOM_DATA_REFRESH_EVENT = "stocvest:trading-room:data-refresh";

export type TradingRoomDataRefreshDetail = {
  symbol?: string;
  lane?: FeedLane;
};

export function notifyTradingRoomDataRefresh(detail?: TradingRoomDataRefreshDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TRADING_ROOM_DATA_REFRESH_EVENT, { detail }));
}

async function fetchSymbolSnapshot(symbol: string): Promise<SnapshotPayload | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(sym)}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
    const row = Array.isArray(json.snapshots) ? json.snapshots[0] : null;
    return row?.symbol ? row : null;
  } catch {
    return null;
  }
}

export type RefreshTradingRoomCardOptions = {
  /** When the symbol is open in deep dive, also refresh the opposite lane composite. */
  refreshBothLanes?: boolean;
};

/**
 * Full refresh for one feed or watchlist card:
 * maturation composite → desk SWR → composite cache → live snapshot.
 */
export async function refreshTradingRoomCard(
  symbol: string,
  lane: FeedLane,
  opts: RefreshTradingRoomCardOptions = {}
): Promise<{ snapshot: SnapshotPayload | null }> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { snapshot: null };

  await refreshWatchlistSymbolMaturationDesk(sym, lane);
  void mutate(deskTodayKey(lane));
  await revalidateSignalCompositeCache(sym, lane);

  if (opts.refreshBothLanes) {
    const other: FeedLane = lane === "day" ? "swing" : "day";
    await revalidateSignalCompositeCache(sym, other);
  }

  const snapshot = await fetchSymbolSnapshot(sym);
  notifyTradingRoomDataRefresh({ symbol: sym, lane });
  return { snapshot };
}
