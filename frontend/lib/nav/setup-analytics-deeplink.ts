/** Deep links for B46 setup analytics surfaces (mode-isolated). */

import { dashboardTradingRoomHref, tradingRoomLaneFromMode } from "@/lib/nav/dashboard-trading-room-deeplink";

export function setupEvolutionHubHref(symbol: string, mode: "swing" | "day"): string {
  const sym = symbol.trim().toUpperCase();
  const qs = new URLSearchParams({ symbol: sym, trading_mode: mode });
  return `/dashboard/setup-evolution?${qs.toString()}`;
}

export function setupOutcomesHref(mode: "swing" | "day"): string {
  const qs = new URLSearchParams({ trading_mode: mode });
  return `/dashboard/setup-outcomes?${qs.toString()}`;
}

export function signalsWithSymbolHref(
  symbol: string,
  mode: "swing" | "day",
  ref: "setup-evolution" | "setup-outcomes" = "setup-evolution"
): string {
  const sym = symbol.trim().toUpperCase();
  return dashboardTradingRoomHref(sym, tradingRoomLaneFromMode(mode), { ref });
}

/** Opens Trading Room deep-dive (replaces Signals + evidence modal). */
export function signalsOpenEvidenceHref(
  symbol: string,
  mode: "swing" | "day",
  ref: "setup-evolution" | "setup-outcomes" = "setup-evolution"
): string {
  return signalsWithSymbolHref(symbol, mode, ref);
}

/** In-page anchor replaced by deep-dive — link opens trading room for symbol. */
export function signalsLayersSectionHref(symbol: string, mode: "swing" | "day"): string {
  return signalsWithSymbolHref(symbol, mode);
}
