/**
 * Watchlist alignment breakdown — layer names from maturation-summary / transitions.
 */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const MATURATION_LAYER_ORDER = [
  "technical",
  "sector",
  "internals",
  "macro",
  "news",
  "geopolitical"
] as const;

const LAYER_DISPLAY: Record<string, string> = {
  technical: "Technical",
  sector: "Sector",
  internals: "Internals",
  macro: "Macro",
  news: "News",
  geopolitical: "Geopolitical"
};

export function formatMaturationLayerKey(key: string): string {
  const k = key.trim().toLowerCase();
  return LAYER_DISPLAY[k] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function maturationAlignmentCounts(row: WatchlistMaturationRow | undefined): {
  aligned: number;
  total: number;
} {
  const total =
    typeof row?.layers_total === "number" && row.layers_total > 0 ? row.layers_total : 6;
  const aligned =
    typeof row?.layers_aligned === "number" && Number.isFinite(row.layers_aligned)
      ? Math.max(0, Math.min(total, Math.round(row.layers_aligned)))
      : 0;
  return { aligned, total };
}

export function alignedLayerNames(row: WatchlistMaturationRow | undefined): string[] {
  const missing = new Set((row?.missing_layers ?? []).map((k) => k.trim().toLowerCase()));
  return MATURATION_LAYER_ORDER.filter((k) => !missing.has(k)).map(formatMaturationLayerKey);
}

export function missingLayerNames(row: WatchlistMaturationRow | undefined): string[] {
  const raw = row?.missing_layers ?? [];
  if (raw.length > 0) {
    return raw.map(formatMaturationLayerKey);
  }
  const { aligned, total } = maturationAlignmentCounts(row);
  if (aligned >= total) return [];
  return ["Remaining confirmation layers"];
}

export function formatMaturationBiasLabel(bias: string | undefined | null): string | null {
  const b = (bias ?? "").trim().toLowerCase();
  if (b === "long" || b === "bullish") return "Long bias";
  if (b === "short" || b === "bearish") return "Short bias";
  if (b === "neutral") return "Neutral bias";
  return null;
}
