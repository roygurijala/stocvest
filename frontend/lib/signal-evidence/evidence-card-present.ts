/**
 * Evidence card presentation — diagnostic copy only (bias, alignment, layer drivers).
 * Shares alignment / insight helpers with the Signals page (`signals-page-present.ts`).
 */

import type { EvidenceLayer, EvidenceStatus } from "@/lib/signal-evidence";
import {
  buildLayerInsightLine,
  countLayerAlignment,
  layerPolarity,
  pickPreviewLayers,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";

export const EVIDENCE_NEWS_NO_CATALYST = "No active catalyst";

export function evidenceDirectionToBias(direction: string): SignalsSetupBias {
  const d = direction.trim().toLowerCase();
  if (d === "bullish" || d === "long") return "Bullish";
  if (d === "bearish" || d === "short") return "Bearish";
  return "Neutral";
}

export function evidenceLayerToRow(layer: EvidenceLayer): SignalsLayerRowInput {
  const sectorPending =
    layer.key === "sector" && layer.sector_resolution_state === "pending_cache_refresh";
  const unavailable = layer.status === "Unavailable" || sectorPending;
  return {
    key: layer.key,
    name: layer.name,
    status: sectorPending ? "Unavailable" : layer.status,
    statusLabel: sectorPending ? "Unavailable (not factored)" : undefined,
    explanation: layer.explanation,
    score: unavailable ? null : layer.contributionScore,
    sectorCachePending: sectorPending || undefined
  };
}

export function evidenceLayersToRows(layers: EvidenceLayer[]): SignalsLayerRowInput[] {
  return layers.map(evidenceLayerToRow);
}

export function buildEvidenceAnchorLine(
  bias: SignalsSetupBias,
  alignment: ReturnType<typeof countLayerAlignment>
): string {
  const biasWord = bias.toLowerCase();
  const supportVerb = bias === "Bearish" ? "support downside" : bias === "Bullish" ? "support it" : "align";

  if (bias === "Neutral") {
    return alignment.aligned >= 4
      ? "Bias is neutral — most layers are neutral; no directional pressure dominates."
      : "Bias is neutral — layers are mixed; no single direction drives this read.";
  }

  if (alignment.label === "Aligned") {
    return `Bias is ${biasWord} and ${alignment.aligned}/${alignment.total} layers ${supportVerb} — directional pressure is concentrated.`;
  }

  if (alignment.label === "Partially aligned") {
    return `Bias is ${biasWord}, but only ${alignment.aligned}/${alignment.total} layers ${supportVerb} — partial alignment, not a full setup.`;
  }

  return `Bias is ${biasWord}, but only ${alignment.aligned}/${alignment.total} layers ${supportVerb} — not enough for a valid setup.`;
}

export function pickPrimaryLayerDrivers(layers: EvidenceLayer[], bias: SignalsSetupBias): string[] {
  const sorted = [...layers].sort(
    (a, b) => (b.contributionScore ?? -1) - (a.contributionScore ?? -1)
  );
  const target: EvidenceStatus | null =
    bias === "Bullish" ? "Bullish" : bias === "Bearish" ? "Bearish" : null;
  if (target) {
    const aligned = sorted.filter((l) => l.status === target);
    if (aligned.length >= 2) return aligned.slice(0, 2).map((l) => l.name);
    const headwinds = sorted.filter((l) => l.status !== target && l.status !== "Neutral");
    if (alignmentIsLow(bias, layers) && headwinds.length >= 2) {
      return headwinds.slice(0, 2).map((l) => l.name);
    }
  }
  return sorted.slice(0, 2).map((l) => l.name);
}

function alignmentIsLow(bias: SignalsSetupBias, layers: EvidenceLayer[]): boolean {
  const rows = evidenceLayersToRows(layers);
  return countLayerAlignment(rows, bias).aligned < 2;
}

export function pickMissingConfirmationLayers(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  limit = 2
): string[] {
  const neutralOrBlocking = rows.filter((r) => {
    const p = layerPolarity(r, bias);
    return p === "blocking" || p === "neutral";
  });
  const preview = pickPreviewLayers(neutralOrBlocking, bias, limit);
  return preview.map((r) => r.name);
}

export function pickLeadingLayers(rows: SignalsLayerRowInput[], bias: SignalsSetupBias, limit = 2): string[] {
  const supportive = rows.filter((r) => layerPolarity(r, bias) === "supportive");
  if (supportive.length > 0) {
    return supportive
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, limit)
      .map((r) => r.name);
  }
  return [...rows]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, limit)
    .map((r) => r.name);
}

export function formatDriversStrip(input: {
  aligned: number;
  total: number;
  leading: string[];
  missing: string[];
}): string {
  const lead = input.leading.length ? input.leading.join(", ") : "—";
  const miss = input.missing.length ? input.missing.join(", ") : "—";
  return `Aligned ${input.aligned}/${input.total} · Leading ${lead} · Missing ${miss}`;
}

export { buildLayerInsightLine, countLayerAlignment };
