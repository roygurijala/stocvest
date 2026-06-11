/**
 * Trading Room mount refresh — re-run composites for sidebar symbols when evaluations
 * are missing or older than a short TTL so rail cards match the deep dive.
 */

import { refreshWatchlistSymbolMaturationDesk } from "@/lib/watchlist-maturation-prime";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { notifyWatchlistMaturationUpdated } from "@/lib/watchlist-maturation-bump";

async function fetchMaturationBySymbol(mode: "swing" | "day"): Promise<Record<string, WatchlistMaturationRow>> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!res) return {};
    if (res.ok || (res.status !== 429 && res.status < 500) || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (!res?.ok) return {};
  const json = await res.json().catch(() => ({}));
  return parseMaturationSummaryEnvelope(json).bySymbol;
}

/** Re-composite when evaluation is older than this (mount + periodic refresh). */
export const TRADING_ROOM_MATURATION_MAX_AGE_MS = 10 * 60 * 1000;

/** Poll interval while the trading room stays open during RTH. */
export const TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS = TRADING_ROOM_MATURATION_MAX_AGE_MS;

/** Cap composites per mount/periodic refresh to avoid rate-limit storms on cold load. */
export const MAX_SYMBOLS_PER_MOUNT = 12;

/** On page load, refresh stale feed + watchlist symbols (same cap as periodic refresh). */
export const TRADING_ROOM_MOUNT_MAX_SYMBOLS = MAX_SYMBOLS_PER_MOUNT;
const CONCURRENCY = 3;

export async function fetchDefaultWatchlistSymbols(): Promise<string[]> {
  try {
    const res = await fetch("/api/stocvest/watchlists/default/symbols", {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => ({}))) as { symbols?: string[] };
    return Array.isArray(json.symbols)
      ? json.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function needsRefresh(row: WatchlistMaturationRow | undefined, maxAgeMs: number): boolean {
  const raw = row?.last_evaluated_at;
  if (!raw?.trim()) return true;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > maxAgeMs;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Re-composite sidebar symbols on trading-room mount when their maturation row is
 * stale by age. Always bumps maturation-summary consumers after work completes.
 */
export async function refreshTradingRoomSidebarMaturation(
  symbols: string[],
  dualDesk: boolean,
  opts?: { maxAgeMs?: number; maxSymbols?: number }
): Promise<{ refreshed: string[] }> {
  const maxAgeMs = opts?.maxAgeMs ?? TRADING_ROOM_MATURATION_MAX_AGE_MS;
  const cap = opts?.maxSymbols ?? MAX_SYMBOLS_PER_MOUNT;
  const deduped = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const unique = cap >= deduped.length ? deduped : deduped.slice(0, cap);
  if (unique.length === 0) return { refreshed: [] };

  const desks: Array<"swing" | "day"> = dualDesk ? ["swing", "day"] : ["swing"];
  let swingBy: Record<string, WatchlistMaturationRow> = {};
  let dayBy: Record<string, WatchlistMaturationRow> = {};
  try {
    swingBy = await fetchMaturationBySymbol("swing");
    if (dualDesk) {
      dayBy = await fetchMaturationBySymbol("day");
    }
  } catch {
    return { refreshed: [] };
  }

  const work: Array<{ symbol: string; desk: "swing" | "day" }> = [];
  for (const sym of unique) {
    for (const desk of desks) {
      const row = desk === "swing" ? swingBy[sym] : dayBy[sym];
      if (needsRefresh(row, maxAgeMs)) work.push({ symbol: sym, desk });
    }
  }

  const refreshed = new Set<string>();
  await runWithConcurrency(work, CONCURRENCY, async (w) => {
    const ok = await refreshWatchlistSymbolMaturationDesk(w.symbol, w.desk);
    if (ok) refreshed.add(w.symbol);
  });

  if (refreshed.size > 0) {
    for (const sym of refreshed) {
      for (const desk of desks) {
        notifyWatchlistMaturationUpdated(sym, desk);
      }
    }
  }

  return { refreshed: [...refreshed] };
}
