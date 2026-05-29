/**
 * Earnings API shapes + pure normalization — safe for Client Components.
 * Do not import server-only modules (e.g. `@/lib/api/client`) from this file.
 */

export interface EarningsEvent {
  symbol: string;
  company_name: string;
  report_date: string;
  report_time: "before_market" | "after_market" | "during_market" | "unknown";
  estimated_eps?: number | null;
  actual_eps?: number | null;
  surprise_percent?: number | null;
  market_cap?: number | null;
}

export interface EarningsResponse {
  symbols: string[];
  days: number;
  /** Present when the API returns the full market calendar (not symbol-filtered). */
  scope?: "market" | "symbols";
  upcoming: EarningsEvent[];
  recent: EarningsEvent[];
  /** Set when no earnings provider returned data (e.g. missing FINNHUB_API_KEY or Polygon tier). */
  notice?: string | null;
  /** Provider that supplied rows: finnhub | benzinga | polygon | fmp | empty */
  source?: string | null;
}

/** Merge watchlist + defaults for earnings API queries (watchlist symbols first). */
export function resolveEarningsSymbolList(
  defaults: readonly string[],
  extra: readonly string[],
  opts?: { max?: number }
): string[] {
  const max = opts?.max ?? 30;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...extra, ...defaults]) {
    const sym = String(raw || "").trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= max) break;
  }
  return out;
}

export const DEFAULT_EARNINGS_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B", "UNH", "JNJ",
  "V", "MA", "JPM", "HD", "PG", "XOM", "CVX", "LLY", "AVGO", "MRK", "DELL"
];

export function normalizeEarningsResponse(
  cleanSymbols: string[],
  days: number,
  payload: EarningsResponse | null
): EarningsResponse {
  const fallback: EarningsResponse = { symbols: cleanSymbols, days, upcoming: [], recent: [], notice: null };
  if (!payload) {
    return fallback;
  }
  const source =
    typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : null;
  const scope = payload.scope === "market" ? "market" : payload.scope === "symbols" ? "symbols" : undefined;
  return {
    symbols: payload.symbols || cleanSymbols,
    days: payload.days || days,
    scope,
    upcoming: Array.isArray(payload.upcoming) ? payload.upcoming : [],
    recent: Array.isArray(payload.recent) ? payload.recent : [],
    notice: typeof payload.notice === "string" && payload.notice.trim() ? payload.notice.trim() : null,
    source
  };
}
