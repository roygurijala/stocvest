import { apiFetch } from "@/lib/api/client";

export type WatchlistMaturationSymbolPayload = {
  state?: string;
  readiness_label?: string;
  /** Human state name (e.g. "Actionable") */
  label?: string;
};

export type WatchlistMaturationSummary = {
  mode?: string;
  by_symbol?: Record<string, WatchlistMaturationSymbolPayload>;
};

/** Maturation states for default-watchlist symbols (see ``GET /v1/watchlists/maturation-summary``). */
export async function fetchWatchlistMaturationSummary(
  mode: "day" | "swing" = "day"
): Promise<WatchlistMaturationSummary | null> {
  const qs = new URLSearchParams({ mode }).toString();
  try {
    return await apiFetch<WatchlistMaturationSummary>(`/v1/watchlists/maturation-summary?${qs}`);
  } catch {
    return null;
  }
}

export type DefaultWatchlistSnapshot = {
  symbols: string[];
  symbol_tracking: Record<string, { swing: boolean; day: boolean }>;
};

function coerceTrackingMap(
  raw: unknown,
  symbols: string[]
): Record<string, { swing: boolean; day: boolean }> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, { swing: boolean; day: boolean }> = {};
  for (const sym of symbols) {
    const row = src[sym];
    if (row && typeof row === "object") {
      const o = row as { swing?: unknown; day?: unknown };
      out[sym] = { swing: Boolean(o.swing ?? true), day: Boolean(o.day ?? true) };
    } else {
      out[sym] = { swing: true, day: true };
    }
  }
  return out;
}

/** Default watchlist symbols + per-symbol desk tracking (presentation prefs). */
export async function fetchDefaultWatchlistSnapshot(): Promise<DefaultWatchlistSnapshot> {
  try {
    const data = await apiFetch<{ symbols?: string[]; symbol_tracking?: unknown }>(
      "/v1/watchlists/default/symbols"
    );
    if (!data || !Array.isArray(data.symbols)) {
      return { symbols: [], symbol_tracking: {} };
    }
    const symbols = data.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    return { symbols, symbol_tracking: coerceTrackingMap(data.symbol_tracking, symbols) };
  } catch {
    return { symbols: [], symbol_tracking: {} };
  }
}

/** Default watchlist symbols for the signed-in user; empty if unauthenticated or on failure. */
export async function fetchDefaultWatchlistSymbols(): Promise<string[]> {
  const snap = await fetchDefaultWatchlistSnapshot();
  return snap.symbols;
}
