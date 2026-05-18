/** Deep links for B46 setup analytics surfaces (mode-isolated). */

export function setupEvolutionHubHref(symbol: string, mode: "swing" | "day"): string {
  const sym = symbol.trim().toUpperCase();
  const qs = new URLSearchParams({ symbol: sym, trading_mode: mode });
  return `/dashboard/setup-evolution?${qs.toString()}`;
}

export function setupOutcomesHref(mode: "swing" | "day"): string {
  const qs = new URLSearchParams({ trading_mode: mode });
  return `/dashboard/setup-outcomes?${qs.toString()}`;
}

export function signalsWithSymbolHref(symbol: string, mode: "swing" | "day"): string {
  const sym = symbol.trim().toUpperCase();
  const qs = new URLSearchParams({ symbol: sym, trading_mode: mode });
  return `/dashboard/signals?${qs.toString()}`;
}

/** Opens Signals and auto-opens the evidence modal (client strips query after load). */
export function signalsOpenEvidenceHref(symbol: string, mode: "swing" | "day"): string {
  const sym = symbol.trim().toUpperCase();
  const qs = new URLSearchParams({ symbol: sym, trading_mode: mode, open_evidence: "1" });
  return `/dashboard/signals?${qs.toString()}`;
}

/** In-page anchor on Signals for the six-layer breakdown block. */
export function signalsLayersSectionHref(symbol: string, mode: "swing" | "day"): string {
  return `${signalsWithSymbolHref(symbol, mode)}#signals-layers`;
}
