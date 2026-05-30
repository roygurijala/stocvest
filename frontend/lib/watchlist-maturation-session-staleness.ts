/**
 * Session staleness for login-triggered watchlist maturation refresh.
 * A symbol is stale when it has no evaluation or last_evaluated_at is before today's NY calendar date.
 */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export function nyTradingDateIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function evaluatedTradingDateEt(iso: string | undefined | null): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return nyTradingDateIso(d);
}

/** True when the row needs a composite run for the current NY session day. */
export function isMaturationStaleForTodaySession(
  row: WatchlistMaturationRow | undefined,
  sessionDate: string = nyTradingDateIso()
): boolean {
  const evalDate = evaluatedTradingDateEt(row?.last_evaluated_at);
  if (!evalDate) return true;
  return evalDate < sessionDate;
}

export type WatchlistMaturationDesk = "swing" | "day";

export function collectStaleWatchlistSymbols(
  symbols: string[],
  desks: WatchlistMaturationDesk[],
  swingBySymbol: Record<string, WatchlistMaturationRow>,
  dayBySymbol: Record<string, WatchlistMaturationRow>,
  sessionDate: string = nyTradingDateIso()
): { symbol: string; desk: WatchlistMaturationDesk }[] {
  const out: { symbol: string; desk: WatchlistMaturationDesk }[] = [];
  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    for (const desk of desks) {
      const row = desk === "swing" ? swingBySymbol[sym] : dayBySymbol[sym];
      if (isMaturationStaleForTodaySession(row, sessionDate)) {
        out.push({ symbol: sym, desk });
      }
    }
  }
  return out;
}
