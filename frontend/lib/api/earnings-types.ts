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
  upcoming: EarningsEvent[];
  recent: EarningsEvent[];
  /** Set when Polygon denies earnings/Benzinga access (plan tier). */
  notice?: string | null;
}

export const DEFAULT_EARNINGS_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B", "UNH", "JNJ",
  "V", "MA", "JPM", "HD", "PG", "XOM", "CVX", "LLY", "AVGO", "MRK"
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
  return {
    symbols: payload.symbols || cleanSymbols,
    days: payload.days || days,
    upcoming: Array.isArray(payload.upcoming) ? payload.upcoming : [],
    recent: Array.isArray(payload.recent) ? payload.recent : [],
    notice: typeof payload.notice === "string" && payload.notice.trim() ? payload.notice.trim() : null
  };
}
