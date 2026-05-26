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
export type SignalsContextRef = "watchlist" | "scanner" | "validation" | "journal";

/** Deep-link to Signals with symbol + contextual ref (honored by `page.tsx`). */
export function contextualSignalsHref(
  symbol: string,
  ref: SignalsContextRef,
  tradingMode?: "day" | "swing"
): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "/dashboard/signals";
  const q = new URLSearchParams();
  q.set("symbol", sym);
  q.set("ref", ref);
  if (tradingMode) q.set("trading_mode", tradingMode);
  return `/dashboard/signals?${q.toString()}`;
}

export function watchlistToSignalsHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsHref(symbol, "watchlist", tradingMode);
}

export function scannerToSignalsHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsHref(symbol, "scanner", tradingMode);
}

/** Deep-link to Signals with symbol prefill and auto-open Evidence modal on load. */
export function contextualSignalsOpenEvidenceHref(
  symbol: string,
  ref: SignalsContextRef,
  tradingMode?: "day" | "swing"
): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "/dashboard/signals";
  const q = new URLSearchParams();
  q.set("symbol", sym);
  q.set("ref", ref);
  if (tradingMode) q.set("trading_mode", tradingMode);
  q.set("open_evidence", "1");
  return `/dashboard/signals?${q.toString()}`;
}

export function scannerOpenEvidenceHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsOpenEvidenceHref(symbol, "scanner", tradingMode);
}

/** Screen-reader label for a ticker link into Signals from watchlist context. */
export function watchlistSignalsOpenAriaLabel(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t ? `Open ${t} on Signals` : "Open Signals";
}
