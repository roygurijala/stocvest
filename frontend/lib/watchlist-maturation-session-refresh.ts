/**
 * Login / page-load refresh: re-run composites for stale default-watchlist symbols (this user only).
 */

import { refreshWatchlistSymbolMaturationDesk } from "@/lib/watchlist-maturation-prime";
import {
  collectStaleWatchlistSymbols,
  nyTradingDateIso,
  type WatchlistMaturationDesk
} from "@/lib/watchlist-maturation-session-staleness";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

const SESSION_REFRESH_STORAGE_PREFIX = "stocvest_maturation_session_refresh";

function sessionRefreshStorageKey(sessionDate: string): string {
  return `${SESSION_REFRESH_STORAGE_PREFIX}_${sessionDate}`;
}

function readRefreshedToday(sessionDate: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(sessionRefreshStorageKey(sessionDate));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function writeRefreshedToday(sessionDate: string, keys: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(sessionRefreshStorageKey(sessionDate), JSON.stringify([...keys]));
  } catch {
    /* ignore quota */
  }
}

function workKey(symbol: string, desk: WatchlistMaturationDesk): string {
  return `${symbol.trim().toUpperCase()}:${desk}`;
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

export type RefreshStaleWatchlistMaturationInput = {
  symbols: string[];
  swingBySymbol: Record<string, WatchlistMaturationRow>;
  dayBySymbol?: Record<string, WatchlistMaturationRow>;
  desks: WatchlistMaturationDesk[];
  concurrency?: number;
  sessionDate?: string;
};

export type RefreshStaleWatchlistMaturationResult = {
  sessionDate: string;
  attempted: number;
  refreshed: string[];
  skippedAlreadyDone: number;
};

/**
 * Refresh symbols stale for today's NY session. Skips work already completed in this browser tab today.
 */
export async function refreshStaleWatchlistMaturation(
  input: RefreshStaleWatchlistMaturationInput
): Promise<RefreshStaleWatchlistMaturationResult> {
  const sessionDate = input.sessionDate ?? nyTradingDateIso();
  const dayBySymbol = input.dayBySymbol ?? {};
  const stale = collectStaleWatchlistSymbols(
    input.symbols,
    input.desks,
    input.swingBySymbol,
    dayBySymbol,
    sessionDate
  );
  const done = readRefreshedToday(sessionDate);
  const pending = stale.filter((w) => !done.has(workKey(w.symbol, w.desk)));
  const refreshed: string[] = [];
  const concurrency = Math.max(1, Math.min(6, input.concurrency ?? 3));

  await runWithConcurrency(pending, concurrency, async (w) => {
    const key = workKey(w.symbol, w.desk);
    const ok = await refreshWatchlistSymbolMaturationDesk(w.symbol, w.desk);
    if (ok) {
      done.add(key);
      if (!refreshed.includes(w.symbol)) refreshed.push(w.symbol);
    }
  });

  writeRefreshedToday(sessionDate, done);

  return {
    sessionDate,
    attempted: pending.length,
    refreshed,
    skippedAlreadyDone: stale.length - pending.length
  };
}
