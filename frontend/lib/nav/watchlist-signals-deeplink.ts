/**
 * Deep-link from watchlist/scanner UI into Trading Room deep-dive (replaces `/dashboard/signals`).
 */
import {
  dashboardTradingRoomHref,
  tradingRoomLaneFromMode
} from "@/lib/nav/dashboard-trading-room-deeplink";

export type SignalsContextRef = "watchlist" | "scanner" | "validation" | "journal";

function laneForMode(tradingMode?: "day" | "swing") {
  return tradingRoomLaneFromMode(tradingMode);
}

/** Deep-link to Trading Room deep-dive with symbol + contextual ref. */
export function contextualSignalsHref(
  symbol: string,
  ref: SignalsContextRef,
  tradingMode?: "day" | "swing"
): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "/dashboard";
  return dashboardTradingRoomHref(sym, laneForMode(tradingMode), { ref });
}

export function watchlistToSignalsHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsHref(symbol, "watchlist", tradingMode);
}

export function scannerToSignalsHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsHref(symbol, "scanner", tradingMode);
}

/** Evidence modal replaced by deep-dive — same destination as contextual href. */
export function contextualSignalsOpenEvidenceHref(
  symbol: string,
  ref: SignalsContextRef,
  tradingMode?: "day" | "swing"
): string {
  return contextualSignalsHref(symbol, ref, tradingMode);
}

export function scannerOpenEvidenceHref(symbol: string, tradingMode?: "day" | "swing"): string {
  return contextualSignalsOpenEvidenceHref(symbol, "scanner", tradingMode);
}

/** Screen-reader label for a ticker link into Trading Room from watchlist context. */
export function watchlistSignalsOpenAriaLabel(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t ? `Open ${t} in Trading Room` : "Open Trading Room";
}
