import { apiFetch } from "@/lib/api/client";

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
