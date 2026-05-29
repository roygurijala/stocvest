/** Refs that authorize `?symbol=` prefill on `/dashboard/signals`. */
const CONTEXTUAL_SIGNALS_REFS = new Set([
  "scanner",
  "watchlist",
  "validation",
  "journal",
  "setup-outcomes",
  "setup-evolution"
]);

export function normalizeSignalsPrefillTicker(sym: string): string | null {
  const u = sym.trim().toUpperCase();
  if (!u) return null;
  if (/^[A-Z]{1,6}$/.test(u)) return u;
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(u)) return u;
  return null;
}

/** True when navigation from this ref should seed the Signals search bar. */
export function signalsRefAllowsSymbolPrefill(ref: string): boolean {
  const r = ref.trim().toLowerCase();
  if (!r) return false;
  if (CONTEXTUAL_SIGNALS_REFS.has(r)) return true;
  return r === "dashboard" || r.startsWith("dashboard-");
}

export function resolveSignalsUrlSymbol(symbolRaw: string, refRaw: string): string | null {
  const symRaw = symbolRaw.trim().toUpperCase();
  if (!symRaw || !signalsRefAllowsSymbolPrefill(refRaw)) return null;
  return normalizeSignalsPrefillTicker(symRaw);
}
