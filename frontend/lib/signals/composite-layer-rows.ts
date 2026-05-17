/**
 * Map composite API payloads → Signals layer rows (shared by Signals page + Scenario Builder).
 */

import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { normalizeSetupBias, type SignalsLayerRowInput, type SignalsSetupBias } from "@/lib/signals-page-present";

export const COMPOSITE_LAYER_KEYS = [
  "technical",
  "news",
  "macro",
  "sector",
  "geopolitical",
  "internals"
] as const;

const LAYER_DISPLAY: Record<string, string> = {
  technical: "Technical",
  news: "News",
  macro: "Macro",
  sector: "Sector",
  geopolitical: "Geopolitical",
  internals: "Internals"
};

type LayerStatus =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Unavailable"
  | "As of close";

function verdictToLayerStatus(verdict: string, status: string): LayerStatus {
  const s = status.toLowerCase();
  if (s === "unavailable") {
    const v = verdict.toLowerCase();
    if (v === "bullish" || v === "bearish" || v === "neutral") {
      return "As of close";
    }
    return "Unavailable";
  }
  const v = verdict.toLowerCase();
  if (v === "bullish") return "Bullish";
  if (v === "bearish") return "Bearish";
  return "Neutral";
}

export function compositeToSignalsLayerRows(
  composite: Record<string, unknown> | null | undefined
): SignalsLayerRowInput[] {
  if (!composite || isInsufficientCompositeResponse(composite)) return [];
  const rawLayers = composite.layers;
  if (!Array.isArray(rawLayers)) return [];
  return COMPOSITE_LAYER_KEYS.map((key) => {
    const entry = (rawLayers as Array<Record<string, unknown>>).find(
      (x) => String(x.layer ?? "").toLowerCase() === key
    );
    const score =
      typeof entry?.score === "number" && Number.isFinite(entry.score)
        ? Math.max(0, Math.min(100, Math.round(entry.score)))
        : 0;
    const verdict = typeof entry?.verdict === "string" ? entry.verdict : "neutral";
    const st = typeof entry?.status === "string" ? entry.status : "unavailable";
    const sectorCachePending =
      key === "sector" && String(entry?.sector_resolution_state ?? "") === "pending_cache_refresh";
    const status = sectorCachePending ? "Unavailable" : verdictToLayerStatus(verdict, st);
    const reasoning =
      typeof entry?.reasoning === "string" && entry.reasoning.trim()
        ? entry.reasoning.trim()
        : typeof entry?.explanation === "string" && entry.explanation.trim()
          ? entry.explanation.trim()
          : "";
    return {
      key,
      name: LAYER_DISPLAY[key] ?? key,
      status,
      statusLabel: sectorCachePending ? "Unavailable (not factored)" : undefined,
      explanation: reasoning,
      score,
      sectorCachePending
    };
  });
}

export function deriveSetupBiasFromComposite(
  composite: Record<string, unknown> | null | undefined,
  layerRows: SignalsLayerRowInput[]
): SignalsSetupBias {
  if (composite && !isInsufficientCompositeResponse(composite)) {
    if (typeof composite.signal_summary === "string") {
      const s = String(composite.signal_summary);
      return normalizeSetupBias(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
    }
  }
  if (layerRows.length === 0) return "Neutral";
  const avg = layerRows.reduce((sum, r) => sum + r.score, 0) / layerRows.length;
  return avg >= 58 ? "Bullish" : avg <= 42 ? "Bearish" : "Neutral";
}

export function maturationBiasToSetupBias(bias: string | null | undefined): SignalsSetupBias | null {
  const b = (bias ?? "").trim().toLowerCase();
  if (b === "long" || b === "bullish") return "Bullish";
  if (b === "short" || b === "bearish") return "Bearish";
  if (b === "neutral") return "Neutral";
  return null;
}
