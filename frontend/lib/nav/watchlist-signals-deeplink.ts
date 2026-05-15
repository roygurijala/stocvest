/**
 * Deep-link from watchlist-related UI to `/dashboard/signals` with contextual prefill.
 * `ref=watchlist` is required so `app/dashboard/signals/page.tsx` honors `symbol` (see
 * `CONTEXTUAL_SIGNALS_REFS`).
 *
 * `trading_mode` is optional; when omitted the Signals client keeps its existing default
 * (typically from localStorage).
 *
 * Blank `symbol` (after trim) returns `/dashboard/signals` with no query — avoids
 * invalid `symbol=` deep links.
 */
export function watchlistToSignalsHref(symbol: string, tradingMode?: "day" | "swing"): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "/dashboard/signals";
  const q = new URLSearchParams();
  q.set("symbol", sym);
  q.set("ref", "watchlist");
  if (tradingMode) q.set("trading_mode", tradingMode);
  return `/dashboard/signals?${q.toString()}`;
}

/** Screen-reader label for a ticker link into Signals from watchlist context. */
export function watchlistSignalsOpenAriaLabel(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t ? `Open ${t} on Signals` : "Open Signals";
}
