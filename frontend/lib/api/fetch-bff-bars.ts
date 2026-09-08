/**
 * Client-safe batched daily bar fetch via the same-origin BFF.
 */
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import { canonicalUsTicker, canonicalUsTickerFromSearch, tickersEquivalent } from "@/lib/symbol-ticker";
import type { WatchlistHeatWindow } from "@/lib/dashboard/trading-room/watchlist-rail-present";

export const BFF_BARS_BATCH_SIZE = 24;

type BarRow = Record<string, unknown>;

function barClose(row: BarRow): number | null {
  const raw = row.c ?? row.close;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function canonicalSymbol(raw: string): string {
  return canonicalUsTicker(raw) ?? canonicalUsTickerFromSearch(raw) ?? raw.trim().toUpperCase();
}

export function barLimitForHeatWindow(window: WatchlistHeatWindow): number {
  if (window === "1w") return 8;
  if (window === "3m") return 70;
  return 280;
}

export function sessionsBackForHeatWindow(window: WatchlistHeatWindow): number {
  if (window === "1w") return 5;
  if (window === "3m") return 63;
  return estimateTradingDaysYtd();
}

function estimateTradingDaysYtd(now = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 1);
  const calendarDays = Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
  return Math.max(1, Math.round(calendarDays * (252 / 365)));
}

export async function fetchBffDailyClosesBatched(
  symbols: readonly string[],
  limit: number
): Promise<Map<string, number[]>> {
  const uniq = [...new Set(symbols.map((s) => canonicalSymbol(s)).filter(Boolean))];
  if (uniq.length === 0) return new Map();

  const out = new Map<string, number[]>();
  for (let i = 0; i < uniq.length; i += BFF_BARS_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + BFF_BARS_BATCH_SIZE);
    try {
      const res = await fetch("/api/stocvest/market/bars-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          requests: chunk.map((symbol) => ({ symbol, timeframe: "1day", limit }))
        })
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as { bars_by_symbol?: Record<string, BarRow[]> };
      const bySym = json.bars_by_symbol ?? {};
      for (const sym of chunk) {
        const rows =
          bySym[sym] ??
          bySym[sym.toUpperCase()] ??
          bySym[sym.toLowerCase()] ??
          [];
        const closes = (Array.isArray(rows) ? rows : [])
          .map((row) => barClose(row))
          .filter((n): n is number => n != null);
        if (closes.length > 0) out.set(sym, closes);
      }
    } catch {
      /* bars are best-effort */
    }
  }
  return out;
}

export function pctFromDailyCloses(closes: number[] | undefined, window: WatchlistHeatWindow): number | null {
  if (!closes || closes.length < 2) return null;
  const back = Math.min(sessionsBackForHeatWindow(window), closes.length - 1);
  return pctChangeOverDailySessions(closes, back);
}

/** Resolve bar closes whether the map key is canonical or an alias (BRK-B vs BRK.B). */
export function lookupDailyCloses(map: ReadonlyMap<string, number[]>, symbol: string): number[] | undefined {
  const sym = symbol.trim().toUpperCase();
  const direct = map.get(sym);
  if (direct) return direct;
  const canon = canonicalSymbol(sym);
  if (canon !== sym) {
    const hit = map.get(canon);
    if (hit) return hit;
  }
  for (const [key, closes] of map) {
    if (tickersEquivalent(key, sym)) return closes;
  }
  return undefined;
}

export function buildHeatWindowChangeMap(
  symbols: readonly string[],
  closesBySymbol: ReadonlyMap<string, number[]>,
  window: WatchlistHeatWindow
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const symbol of symbols) {
    const closes = lookupDailyCloses(closesBySymbol, symbol);
    out.set(symbol.trim().toUpperCase(), pctFromDailyCloses(closes, window));
  }
  return out;
}
