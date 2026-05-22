/**
 * Parsed maturation-summary response envelope (B47 near-ready engagement).
 */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { normalizeWatchlistMaturationBySymbol } from "@/lib/watchlist-page-utils";

export type ProgressBand = "not_aligned" | "developing" | "near_ready" | "actionable";

export type MaturationSummaryEnvelope = {
  mode: "swing" | "day";
  bySymbol: Record<string, WatchlistMaturationRow>;
  nearReadyCount: number;
  nearReadySymbols: string[];
};

/** Coerce API JSON for one desk's maturation-summary. */
export function parseMaturationSummaryEnvelope(payload: unknown): MaturationSummaryEnvelope {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const modeRaw = String(p.mode ?? "swing").trim().toLowerCase();
  const mode: "swing" | "day" = modeRaw === "day" ? "day" : "swing";
  const bySymbol = normalizeWatchlistMaturationBySymbol(payload);

  const countRaw = p.near_ready_count ?? p.nearReadyCount;
  const symbolsRaw = p.near_ready_symbols ?? p.nearReadySymbols;
  let nearReadySymbols: string[] = [];
  if (Array.isArray(symbolsRaw)) {
    nearReadySymbols = symbolsRaw
      .map((x) => (typeof x === "string" ? x.trim().toUpperCase() : ""))
      .filter(Boolean);
  }
  if (nearReadySymbols.length === 0) {
    nearReadySymbols = Object.entries(bySymbol)
      .filter(([, row]) => row.progress_band === "near_ready")
      .map(([sym]) => sym)
      .sort();
  }
  const nearReadyCount =
    typeof countRaw === "number" && Number.isFinite(countRaw) ? Math.max(0, Math.round(countRaw)) : nearReadySymbols.length;

  return { mode, bySymbol, nearReadyCount, nearReadySymbols };
}
