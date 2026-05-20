/**
 * Prime watchlist maturation by running the same composite path as Signals Evidence
 * (persists WatchlistMaturation via backend sync on compute/cache hit).
 */

import { notifyWatchlistMaturationUpdated } from "@/lib/watchlist-maturation-bump";

export type WatchlistMaturationDesk = "swing" | "day";

async function postCompositeForDesk(symbol: string, desk: WatchlistMaturationDesk): Promise<boolean> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return false;
  const url =
    desk === "swing"
      ? "/api/stocvest/signals/composite/swing"
      : "/api/stocvest/signals/composite/real";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ symbol: sym })
  });
  if (res.ok) {
    notifyWatchlistMaturationUpdated(sym, desk);
    return true;
  }
  return false;
}

export async function primeWatchlistSymbolMaturation(
  symbol: string,
  dualDesk: boolean
): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  const modes: WatchlistMaturationDesk[] = dualDesk ? ["swing", "day"] : ["swing"];
  await Promise.allSettled(modes.map((mode) => postCompositeForDesk(sym, mode)));
}

/** Re-run composite for one desk and bump maturation-summary consumers (Watchlist row refresh). */
export async function refreshWatchlistSymbolMaturationDesk(
  symbol: string,
  desk: WatchlistMaturationDesk
): Promise<boolean> {
  return postCompositeForDesk(symbol, desk);
}
