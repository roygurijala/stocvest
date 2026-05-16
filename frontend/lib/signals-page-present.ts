/**
 * Signals page presentation — pure helpers for setup read, layer polarity, and alignment.
 * Keeps copy discipline aligned with `trade-decision.ts` (validates, does not instruct).
 */

import {
  deriveDecisionRationale,
  type TradeDecision,
  type TradeDecisionState
} from "@/lib/signal-evidence/trade-decision";

export type SignalsSetupBias = "Bullish" | "Bearish" | "Neutral";

export type SignalsLayerStatus =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Unavailable"
  | "As of close";

export type SignalsLayerPolarity = "blocking" | "mixed" | "neutral" | "supportive";

export type SignalsLayerRowInput = {
  key: string;
  name: string;
  status: SignalsLayerStatus;
  statusLabel?: string;
  explanation: string;
  score: number;
  sectorCachePending?: boolean;
};

const GENERIC_EXPLANATION_RE =
  /shows the most recent close-state reading|signals align with upside|signals show downside pressure|is mixed without strong direction|data is unavailable right now/i;

const BLOCKING_LAYER_PRIORITY: Record<string, number> = {
  technical: 1,
  vwap_position: 1,
  volume_confirm: 2,
  internals: 3,
  sector: 4,
  news: 5,
  macro: 6,
  geopolitical: 7
};

export function normalizeSetupBias(summary: string): SignalsSetupBias {
  const s = summary.trim().toLowerCase();
  if (s === "bullish") return "Bullish";
  if (s === "bearish") return "Bearish";
  return "Neutral";
}

export function countLayerAlignment(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias
): { aligned: number; total: number; label: string } {
  const total = 6;
  if (bias === "Neutral") {
    const neutralish = rows.filter((r) => r.status === "Neutral" || r.status === "As of close").length;
    return {
      aligned: neutralish,
      total,
      label: neutralish >= 4 ? "Mostly neutral" : "Mixed direction"
    };
  }
  const target = bias === "Bullish" ? "Bullish" : "Bearish";
  const aligned = rows.filter((r) => r.status === target).length;
  return {
    aligned,
    total,
    label: aligned >= 4 ? "Aligned" : aligned >= 2 ? "Partially aligned" : "Not aligned"
  };
}

export function layerPolarity(row: SignalsLayerRowInput, bias: SignalsSetupBias): SignalsLayerPolarity {
  if (row.sectorCachePending || row.status === "Unavailable") return "blocking";
  if (bias === "Neutral") {
    if (row.status === "Bullish" || row.status === "Bearish") return "mixed";
    return "neutral";
  }
  const supportive =
    (bias === "Bullish" && row.status === "Bullish") || (bias === "Bearish" && row.status === "Bearish");
  const blocking =
    (bias === "Bullish" && row.status === "Bearish") || (bias === "Bearish" && row.status === "Bullish");
  if (supportive) return "supportive";
  if (blocking) return "blocking";
  if (row.status === "Neutral" || row.status === "As of close") {
    if (row.name === "Sector" && row.score > 0 && row.score < 55) return "mixed";
    if (row.name === "Internals" && row.score >= 48 && row.score <= 62) return "mixed";
    return "neutral";
  }
  return "neutral";
}

export function layerPolarityDotColor(p: SignalsLayerPolarity): string {
  switch (p) {
    case "blocking":
      return "#ef4444";
    case "mixed":
      return "#f59e0b";
    case "supportive":
      return "#22c55e";
    default:
      return "#94a3b8";
  }
}

export function layerPolarityLabel(p: SignalsLayerPolarity): string {
  switch (p) {
    case "blocking":
      return "Blocking";
    case "mixed":
      return "Mixed";
    case "supportive":
      return "Supportive";
    default:
      return "Neutral";
  }
}

function layerBlockingScore(row: SignalsLayerRowInput, bias: SignalsSetupBias): number {
  const p = layerPolarity(row, bias);
  if (p !== "blocking" && p !== "mixed") return 99;
  const pri = BLOCKING_LAYER_PRIORITY[row.key] ?? 50;
  return p === "blocking" ? pri : pri + 0.5;
}

export function pickPreviewLayers(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  limit = 3
): SignalsLayerRowInput[] {
  return [...rows]
    .sort((a, b) => layerBlockingScore(a, bias) - layerBlockingScore(b, bias))
    .filter((r) => {
      const p = layerPolarity(r, bias);
      return p === "blocking" || p === "mixed";
    })
    .slice(0, limit);
}

export function buildLayerInsightLine(row: SignalsLayerRowInput, bias: SignalsSetupBias): string {
  const custom = row.explanation?.trim();
  if (custom && !GENERIC_EXPLANATION_RE.test(custom)) {
    const short = custom.length > 88 ? `${custom.slice(0, 85)}…` : custom;
    return short;
  }
  const p = layerPolarity(row, bias);
  const name = row.name;
  if (row.sectorCachePending || row.status === "Unavailable") {
    return "Coverage unavailable — not factored into this read";
  }
  if (p === "supportive") {
    if (name === "Technical") return "Structure supports the setup bias";
    if (name === "Internals") return "Breadth supportive for this direction";
    if (name === "Sector") return "Sector participation supportive vs tape";
    return "Supportive vs setup bias";
  }
  if (p === "blocking") {
    if (name === "Technical") return "Weak trend structure — no continuation";
    if (name === "Internals") return "Weak breadth — no confirmation";
    if (name === "Sector") return "Mixed participation — no leadership";
    if (name === "News") return "No catalyst support for this direction";
    if (name === "Macro") return "Macro headwind vs setup bias";
    return "Opposes setup bias";
  }
  if (p === "mixed") {
    if (name === "Sector") return "Mixed participation — no leadership";
    if (name === "Internals") return "Participation mixed — not confirming";
    return "Mixed — not confirming";
  }
  if (name === "News") return "No catalyst — background only";
  if (name === "Macro") return "Neutral — background only";
  if (name === "Geopolitical") return "Neutral — no direct impact";
  return "Neutral — no signal";
}

export function buildSignalsPageDecision(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  signalScore: number | null;
  alignmentRatio: number | null;
  riskReward: number;
  rrWarning: boolean;
  isComplete: boolean;
  counterTrend?: boolean;
  regimeConflict?: boolean;
}): TradeDecision {
  const { rows, bias, signalScore, alignmentRatio, riskReward, rrWarning, isComplete } = input;
  const score = signalScore ?? 50;
  const availableLayers = rows.filter((r) => r.status !== "Unavailable").length;
  const directionalLayers = rows.filter((r) => r.status === "Bullish" || r.status === "Bearish").length;
  const agreementPct =
    alignmentRatio != null && Number.isFinite(alignmentRatio)
      ? Math.round(Math.max(0, Math.min(1, alignmentRatio)) * 100)
      : null;
  const weakAgreement = agreementPct != null ? agreementPct < 52 : directionalLayers < 3;
  const lowReadiness = score < 58;
  const strongReadiness = score >= 68;
  const strongAgreement = agreementPct != null ? agreementPct >= 60 : directionalLayers >= 4;
  const goodCoverage = availableLayers >= 5;
  const hasInsufficient = !isComplete;
  const rrFail = rrWarning || riskReward < 2;
  const counterTrend = input.counterTrend === true;
  const regimeConflict = input.regimeConflict === true;

  const rationaleCtx = {
    rr: riskReward,
    rrFail,
    hasInsufficient,
    coverageThin: availableLayers < 4,
    weakAgreement,
    counterTrend,
    regimeConflict
  };

  const reinforcements: string[] = [];
  if (rrFail) reinforcements.push(`Risk/reward below internal threshold (${riskReward.toFixed(1)}:1).`);
  if (weakAgreement) reinforcements.push("Layer agreement is mixed across desks.");

  if (hasInsufficient || (rrFail && weakAgreement && lowReadiness) || availableLayers < 4) {
    return {
      state: "blocked",
      line: "Not actionable — minimum synthesis and risk gates not met",
      reinforcements,
      rationale: deriveDecisionRationale("blocked", rationaleCtx)
    };
  }
  if (strongReadiness && !rrFail && strongAgreement && goodCoverage && !counterTrend) {
    return {
      state: "actionable",
      line: "Actionable — internal gates cleared for this setup",
      reinforcements: [],
      rationale: null
    };
  }
  return {
    state: "monitor",
    line: "No actionable setup — confirmation and/or risk gates not fully cleared",
    reinforcements,
    rationale: deriveDecisionRationale("monitor", rationaleCtx)
  };
}

export function actionableHeadline(state: TradeDecisionState): string {
  if (state === "actionable") return "→ Actionable setup — gates cleared";
  return "→ No actionable setup";
}

export function buildWhyNotBullets(
  decision: TradeDecision,
  previewLayers: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  max = 3
): string[] {
  const out: string[] = [];
  if (decision.rationale?.text) {
    out.push(decision.rationale.text);
  }
  for (const row of previewLayers) {
    if (out.length >= max) break;
    const line = buildLayerInsightLine(row, bias);
    const tagged = `${row.name}: ${line}`;
    if (!out.some((b) => b.includes(row.name))) out.push(tagged);
  }
  return out.slice(0, max);
}

export const REFERENCE_LEVEL_HINTS: Record<string, string> = {
  vwap: "intraday balance",
  support: "prior structure",
  resistance: "recent high",
  orHigh: "opening range high",
  orLow: "opening range low"
};
