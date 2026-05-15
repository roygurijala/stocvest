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

/** Default watchlist symbols for the signed-in user; empty if unauthenticated or on failure. */
export async function fetchDefaultWatchlistSymbols(): Promise<string[]> {
  try {
    const data = await apiFetch<{ symbols?: string[] }>("/v1/watchlists/default/symbols");
    if (!data || !Array.isArray(data.symbols)) {
      return [];
    }
    return data.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}
