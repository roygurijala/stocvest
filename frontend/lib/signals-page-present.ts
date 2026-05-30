/**
 * Signals page presentation — pure helpers for setup read, layer polarity, and alignment.
 * Keeps copy discipline aligned with `trade-decision.ts` (validates, does not instruct).
 */

import {
  formatAlignmentStatusLine,
  formatLayersFromActionableHint,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import {
  formatNeutralAlignmentUserLine,
  NEUTRAL_ALIGNMENT_SUBLINE
} from "@/lib/watchlist-maturation-bias-present";
import {
  deriveDecisionRationale,
  type DecisionRationaleCategory,
  type TradeDecision,
  type TradeDecisionState
} from "@/lib/signal-evidence/trade-decision";
import type { MarketStatusPayload } from "@/lib/api/market";
import type { SwingCompositeMarketStatus } from "@/lib/api/swing-composite";
import { isRegularSessionOpen } from "@/lib/market/regular-session";
import {
  isRrBelowVerdictThreshold,
  minRiskRewardForVerdict,
  resolveTradeConvictionTier
} from "@/lib/trade-conviction-tier";

export type SignalsSetupBias = "Bullish" | "Bearish" | "Neutral";

export type SignalsLayerStatus =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Unavailable"
  | "As of close";

export type SignalsLayerPolarity = "blocking" | "mixed" | "neutral" | "supportive";

/** Neutral baseline for Signal Radar Δ bars and “vs baseline” copy (matches `radarData.hist`). */
export const SIGNAL_LAYER_LEVEL_BASELINE = 50;

export type SignalsLayerRowInput = {
  key: string;
  name: string;
  status: SignalsLayerStatus;
  statusLabel?: string;
  explanation: string;
  /** Null when the API has no live layer score (do not treat as 0). */
  score: number | null;
  /** Today − baseline, when score is known (same scale as divergence chart). */
  deltaVsBaseline?: number | null;
  sectorCachePending?: boolean;
};

export function layerDeltaVsBaseline(
  score: number | null,
  baseline: number = SIGNAL_LAYER_LEVEL_BASELINE
): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.round((score - baseline) * 10) / 10;
}

export function formatDeltaVsBaselineShort(delta: number): string {
  if (delta > 0.05) return `+${delta} Δ today`;
  if (delta < -0.05) return `${delta} Δ today`;
  return "~0 Δ today";
}

export function formatLayerScoreLabel(score: number | null, status: SignalsLayerStatus): string {
  if (status === "Unavailable" && score === null) return "N/A";
  if (score === null) return "—";
  return String(Math.round(score));
}

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

export type SignalsDirectionChip = {
  label: string;
  color: string;
  background: string;
};

/** Command-bar / desk chip — mirrors watchlist Long / Short / No edge. */
export function resolveSignalsDirectionChip(
  bias: SignalsSetupBias,
  colors: { bullish: string; bearish: string; textMuted: string }
): SignalsDirectionChip | null {
  if (bias === "Bullish") {
    return {
      label: "↑ Long",
      color: colors.bullish,
      background: `color-mix(in srgb, ${colors.bullish} 18%, transparent)`
    };
  }
  if (bias === "Bearish") {
    return {
      label: "↓ Short",
      color: colors.bearish,
      background: `color-mix(in srgb, ${colors.bearish} 18%, transparent)`
    };
  }
  if (bias === "Neutral") {
    return {
      label: "No edge",
      color: colors.textMuted,
      background: `color-mix(in srgb, ${colors.textMuted} 14%, transparent)`
    };
  }
  return null;
}

export type CompositeDirectionFields = {
  consistency: number;
  directional: number;
  total: number;
  tilt?: "long" | "short" | null;
};

/** Parsed from composite API (`composite_direction_fields` on swing/real). */
export function parseCompositeDirectionFields(
  body: Record<string, unknown> | null | undefined
): CompositeDirectionFields | null {
  if (!body) return null;
  const consistency = body.consistency_layers_aligned;
  const directional = body.directional_layers_aligned;
  if (typeof consistency !== "number" || typeof directional !== "number") return null;
  const totalRaw = body.layers_total;
  const total =
    typeof totalRaw === "number" && totalRaw > 0 ? Math.round(totalRaw) : SIGNAL_LAYER_ALIGN_TOTAL;
  const tiltRaw = body.directional_tilt;
  const tilt = tiltRaw === "long" || tiltRaw === "short" ? tiltRaw : null;
  return {
    consistency: Math.max(0, Math.min(total, Math.round(consistency))),
    directional: Math.max(0, Math.min(total, Math.round(directional))),
    total,
    tilt
  };
}

/**
 * Whether a layer row counts toward X/6 alignment on Signals and in watchlist maturation
 * (see ``watchlist_maturation_sync._layer_row_available``).
 */
export function layerRowEligibleForAlignmentCount(row: SignalsLayerRowInput): boolean {
  if (row.sectorCachePending || row.status === "Unavailable") return false;
  if (row.score === null) return false;
  return true;
}

export const SIGNAL_LAYER_ALIGN_TOTAL = 6;

/** Map composite `alignment_ratio` (0–1) to a whole-layer X/6 count. */
export function alignedLayersFromAlignmentRatio(
  alignmentRatio: number | null | undefined,
  total = SIGNAL_LAYER_ALIGN_TOTAL
): number | null {
  if (alignmentRatio == null || !Number.isFinite(alignmentRatio)) return null;
  return Math.round(Math.max(0, Math.min(1, alignmentRatio)) * total);
}

export function countLayerAlignment(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias
): { aligned: number; total: number; label: string } {
  const total = SIGNAL_LAYER_ALIGN_TOTAL;
  if (bias === "Neutral") {
    const neutralish = rows.filter(
      (r) =>
        layerRowEligibleForAlignmentCount(r) &&
        (r.status === "Neutral" || r.status === "As of close")
    ).length;
    return {
      aligned: neutralish,
      total,
      label: neutralish >= 4 ? "Mostly neutral" : "Mixed direction"
    };
  }
  const target = bias === "Bullish" ? "Bullish" : "Bearish";
  const aligned = rows.filter(
    (r) => layerRowEligibleForAlignmentCount(r) && r.status === target
  ).length;
  return {
    aligned,
    total,
    label: aligned >= 4 ? "Aligned" : aligned >= 2 ? "Partially aligned" : "Not aligned"
  };
}

/**
 * Signals X/6 — prefers composite `alignment_ratio` (weighted layer agreement) so the
 * headline matches trade-decision gates and the radar Δ chart is not mistaken for alignment.
 */
export function resolveSignalsLayerAlignment(input: {
  rows: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  alignmentRatio?: number | null;
  compositeDirection?: CompositeDirectionFields | null;
}): { aligned: number; total: number; label: string } {
  const dir = input.compositeDirection;
  if (input.bias === "Neutral" && dir) {
    const label =
      dir.consistency >= 5
        ? "Balanced"
        : dir.directional >= 4
          ? dir.tilt === "long"
            ? "Bullish lean"
            : dir.tilt === "short"
              ? "Bearish lean"
              : "Directional lean"
          : dir.consistency >= 4
            ? "Mostly neutral"
            : "Mixed direction";
    return { aligned: dir.consistency, total: dir.total, label };
  }
  const fromRatio = alignedLayersFromAlignmentRatio(input.alignmentRatio);
  if (fromRatio != null) {
    const total = SIGNAL_LAYER_ALIGN_TOTAL;
    if (input.bias === "Neutral") {
      return {
        aligned: fromRatio,
        total,
        label: fromRatio >= 4 ? "Mostly neutral" : "Mixed direction"
      };
    }
    return {
      aligned: fromRatio,
      total,
      label:
        fromRatio >= 4 ? "Aligned" : fromRatio >= 2 ? "Partially aligned" : "Not aligned"
    };
  }
  return countLayerAlignment(input.rows, input.bias);
}

/** Canonical X/6 + display line for composite-backed surfaces (Signals, Evidence, Scenario). */
export function resolveCompositeLayerAlignment(input: {
  rows: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  alignmentRatio?: number | null;
  maturationState?: string | null;
  compositeDirection?: CompositeDirectionFields | null;
}): { aligned: number; total: number; label: string; displayLine: string } {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio,
    compositeDirection: input.compositeDirection
  });
  return {
    ...alignment,
    displayLine: formatSignalsAlignmentDisplayLine(alignment, input.bias, input.maturationState)
  };
}

/** Bias-aware alignment line for Signals surfaces (no "Strong" on neutral bias). */
export function formatSignalsAlignmentDisplayLine(
  alignment: { aligned: number; total: number; label: string },
  bias: SignalsSetupBias,
  maturationState?: string | null
): string {
  if (bias === "Neutral") {
    return formatNeutralAlignmentUserLine();
  }
  return formatAlignmentStatusLine({
    layersAligned: alignment.aligned,
    layersTotal: alignment.total,
    maturationState
  });
}

/** Alignment KPI subline — neutral uses verdict copy; long/short keep distance-to-actionable hint. */
export function signalsAlignmentKpiSubline(input: {
  bias: SignalsSetupBias;
  alignment: { aligned: number; total: number };
}): string | null {
  if (input.bias === "Neutral") {
    return NEUTRAL_ALIGNMENT_SUBLINE;
  }
  return formatLayersFromActionableHint(input.alignment.aligned, input.alignment.total);
}

export function layerPolarity(row: SignalsLayerRowInput, bias: SignalsSetupBias): SignalsLayerPolarity {
  if (row.sectorCachePending || row.status === "Unavailable") return "blocking";
  if (row.statusLabel?.toLowerCase().includes("as of close")) {
    if (bias === "Neutral") return "neutral";
    const supportive =
      (bias === "Bullish" && row.status === "Bullish") || (bias === "Bearish" && row.status === "Bearish");
    if (supportive) return "supportive";
    const blocking =
      (bias === "Bullish" && row.status === "Bearish") || (bias === "Bearish" && row.status === "Bullish");
    if (blocking) return "blocking";
    return "mixed";
  }
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
    const s = row.score;
    if (s == null) return "neutral";
    if (row.key === "sector" && s > 0 && s < 55) return "mixed";
    if (row.key === "internals" && s >= 48 && s <= 62) return "mixed";
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

/** @deprecated Prefer {@link layerRoleLabel} for user-facing copy. */
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

function biasThesisPhrase(bias: SignalsSetupBias): string {
  if (bias === "Bullish") return "bullish thesis";
  if (bias === "Bearish") return "bearish thesis";
  return "setup";
}

/** Bias-anchored role vs setup (Signals layer breakdown). */
export function layerRoleLabel(p: SignalsLayerPolarity, bias: SignalsSetupBias): string {
  const thesis = biasThesisPhrase(bias);
  if (bias === "Neutral") {
    switch (p) {
      case "supportive":
        return "Aligns with directional lean";
      case "blocking":
        return "Opposes directional lean";
      case "mixed":
        return "Mixed — no clear edge";
      default:
        return "Neutral / no edge";
    }
  }
  switch (p) {
    case "supportive":
      return `Supports ${thesis}`;
    case "blocking":
      return `Conflicts with ${thesis}`;
    case "mixed":
      return "Mixed — not confirming";
    default:
      return "Neutral / no edge";
  }
}

/** Short verdict strength from layer status + level (not composite weight). */
export function layerStatusQualifier(
  row: SignalsLayerRowInput,
  polarity: SignalsLayerPolarity
): string {
  if (row.sectorCachePending || row.status === "Unavailable") return "Unavailable";
  if (row.status === "As of close") return "As of last close";
  const score = row.score;
  const extreme = score != null && Number.isFinite(score) && (score >= 65 || score <= 35);
  if (row.status === "Bullish") return extreme ? "Strong bullish read" : "Bullish read";
  if (row.status === "Bearish") return extreme ? "Strong bearish read" : "Bearish read";
  if (polarity === "mixed") return "Mixed read";
  return "Neutral read";
}

/** One-line layer interpretation: status + role vs bias. */
export function buildLayerRoleHeadline(row: SignalsLayerRowInput, bias: SignalsSetupBias): string {
  const p = layerPolarity(row, bias);
  return `${layerStatusQualifier(row, p)} (${layerRoleLabel(p, bias)})`;
}

export type LayerForceGroups = {
  withBias: SignalsLayerRowInput[];
  againstOrMixed: SignalsLayerRowInput[];
  noEdge: SignalsLayerRowInput[];
  titles: {
    withBias: string;
    againstOrMixed: string;
    noEdge: string;
  };
};

/** Group all six layers for the force-summary strip (Signals only). */
export function groupLayersByForce(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias
): LayerForceGroups {
  const withBias: SignalsLayerRowInput[] = [];
  const againstOrMixed: SignalsLayerRowInput[] = [];
  const noEdge: SignalsLayerRowInput[] = [];

  for (const row of rows) {
    if (bias === "Neutral") {
      if (row.status === "Bullish") withBias.push(row);
      else if (row.status === "Bearish") againstOrMixed.push(row);
      else noEdge.push(row);
      continue;
    }
    const p = layerPolarity(row, bias);
    if (p === "supportive") withBias.push(row);
    else if (p === "blocking" || p === "mixed") againstOrMixed.push(row);
    else noEdge.push(row);
  }

  withBias.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  againstOrMixed.sort((a, b) => layerBlockingScore(a, bias) - layerBlockingScore(b, bias));
  noEdge.sort((a, b) => a.name.localeCompare(b.name));

  const titles =
    bias === "Neutral"
      ? {
          withBias: "Bullish-leaning layers",
          againstOrMixed: "Bearish-leaning layers",
          noEdge: "Neutral / no edge"
        }
      : {
          withBias: `Layers supporting ${bias.toLowerCase()} bias`,
          againstOrMixed: "Layers opposing or mixed",
          noEdge: "Neutral / no edge"
        };

  return { withBias, againstOrMixed, noEdge, titles };
}

export function formatLayerForceNames(rows: SignalsLayerRowInput[]): string {
  if (rows.length === 0) return "—";
  return rows.map((r) => r.name).join(", ");
}

/** Intro copy for Setup → “Why this bias?” section. */
export function buildBiasRationaleIntro(
  bias: SignalsSetupBias,
  rows: SignalsLayerRowInput[],
  signalSummary: string
): string {
  const groups = groupLayersByForce(rows, bias);
  const supportN = groups.withBias.length;
  const opposeN = groups.againstOrMixed.length;
  const neutralN = groups.noEdge.length;
  const summary = signalSummary.trim().toLowerCase();

  if (bias === "Neutral") {
    if (supportN === 0 && opposeN === 0) {
      return "Composite synthesis is neutral — most layers show no directional edge for this desk.";
    }
    return `Composite synthesis is neutral — ${supportN} layer${supportN === 1 ? "" : "s"} lean bullish, ${opposeN} bearish${neutralN > 0 ? `, and ${neutralN} neutral` : ""}. No single direction dominates.`;
  }

  const biasWord = bias.toLowerCase();
  const summaryMatches = summary === biasWord;
  const lead = summaryMatches
    ? `Composite classifies this setup as ${biasWord}`
    : `Desk bias is ${biasWord} (composite summary: ${summary || "—"})`;

  const parts: string[] = [];
  if (supportN > 0) {
    parts.push(
      `${supportN} layer${supportN === 1 ? "" : "s"} support the ${biasWord} read (${formatLayerForceNames(groups.withBias)})`
    );
  }
  if (opposeN > 0) {
    parts.push(
      `${opposeN} layer${opposeN === 1 ? "" : "s"} oppose or are mixed (${formatLayerForceNames(groups.againstOrMixed)})`
    );
  }
  if (neutralN > 0 && parts.length === 0) {
    parts.push(`${neutralN} neutral layer${neutralN === 1 ? "" : "s"} — limited directional confirmation`);
  }

  return parts.length > 0 ? `${lead} — ${parts.join("; ")}.` : `${lead} based on how the six layers reconcile.`;
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
  return pickCollapsedLayerPreview(rows, bias, limit, limit);
}

/** Collapsed breakdown: strongest drivers + top blockers (not arbitrary first three). */
export function pickCollapsedLayerPreview(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  maxDriving = 2,
  maxBlocking = 2
): SignalsLayerRowInput[] {
  const driving = rows
    .filter((r) => layerPolarity(r, bias) === "supportive")
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, maxDriving);
  const blocking = [...rows]
    .filter((r) => {
      const p = layerPolarity(r, bias);
      return p === "blocking" || p === "mixed";
    })
    .sort((a, b) => layerBlockingScore(a, bias) - layerBlockingScore(b, bias))
    .slice(0, maxBlocking);
  const seen = new Set<string>();
  const out: SignalsLayerRowInput[] = [];
  for (const row of [...driving, ...blocking]) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  if (out.length > 0) return out;
  return rows.slice(0, Math.min(3, rows.length));
}

export function layerHasCustomInsight(row: SignalsLayerRowInput): boolean {
  const custom = row.explanation?.trim();
  return Boolean(custom && !GENERIC_EXPLANATION_RE.test(custom));
}

export function buildLayerInsightLine(row: SignalsLayerRowInput, bias: SignalsSetupBias): string {
  const custom = row.explanation?.trim();
  if (custom && !GENERIC_EXPLANATION_RE.test(custom)) {
    const short = custom.length > 88 ? `${custom.slice(0, 85)}…` : custom;
    return short;
  }
  const p = layerPolarity(row, bias);
  const key = row.key;
  if (row.sectorCachePending || row.status === "Unavailable") {
    return "Coverage unavailable — not factored into this read";
  }
  if (row.status === "As of close" && row.key === "technical") {
    return "Daily structure as of last close — live VWAP/ORB resume at the open";
  }
  if (row.status === "As of close") {
    return "As of last close — not a live session read";
  }
  if (p === "supportive") {
    if (key === "technical") return "Structure supports the setup bias";
    if (key === "internals") return "Breadth supportive for this direction";
    if (key === "sector") return "Sector participation supportive vs tape";
    return "Supportive vs setup bias";
  }
  if (p === "blocking") {
    if (key === "technical") return "Weak trend structure — no continuation";
    if (key === "internals") return "Weak breadth — no confirmation";
    if (key === "sector") return "Mixed participation — no leadership";
    if (key === "news") return "No catalyst support for this direction";
    if (key === "macro") return "Macro headwind vs setup bias";
    return "Opposes setup bias";
  }
  if (p === "mixed") {
    if (key === "sector") return "Mixed participation — no leadership";
    if (key === "internals") return "Participation mixed — not confirming";
    return "Mixed — not confirming";
  }
  if (key === "news") return "No catalyst — background only";
  if (key === "macro") return "Neutral — background only";
  if (key === "geopolitical") return "Neutral — no direct impact";
  return "Neutral — no signal";
}

export function buildSignalsPageDecision(input: {
  mode: "swing" | "day";
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  /** @deprecated Use layer alignment — kept for callers not yet migrated. */
  signalScore?: number | null;
  alignmentRatio: number | null;
  riskReward: number;
  rrWarning: boolean;
  isComplete: boolean;
  counterTrend?: boolean;
  regimeConflict?: boolean;
  timeframeCounterTrend?: boolean;
}): TradeDecision {
  const { rows, bias, alignmentRatio, riskReward, rrWarning, isComplete, mode } = input;
  const availableLayers = rows.filter((r) => r.status !== "Unavailable").length;
  const directionalLayers = rows.filter((r) => r.status === "Bullish" || r.status === "Bearish").length;
  const alignment = resolveSignalsLayerAlignment({ rows, bias, alignmentRatio });
  const agreementPct =
    alignmentRatio != null && Number.isFinite(alignmentRatio)
      ? Math.round(Math.max(0, Math.min(1, alignmentRatio)) * 100)
      : null;
  const weakAgreement = agreementPct != null ? agreementPct < 52 : directionalLayers < 3;
  const lowReadiness = alignment.aligned < 3;
  const strongReadiness = alignment.aligned >= 5;
  const strongAgreement = agreementPct != null ? agreementPct >= 60 : directionalLayers >= 4;
  const goodCoverage = availableLayers >= 5;
  const hasInsufficient = !isComplete;
  const rrFail = rrWarning || isRrBelowVerdictThreshold(riskReward, mode);
  const counterTrend = input.counterTrend === true;
  const timeframeCounterTrend = input.timeframeCounterTrend === true;
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

  const convictionBase = {
    mode,
    riskReward,
    layersAligned: alignment.aligned,
    layersTotal: alignment.total,
    counterTrend,
    regimeConflict,
    hasInsufficient
  };

  const reinforcements: string[] = [];
  if (rrFail) {
    const minRr = minRiskRewardForVerdict(mode);
    reinforcements.push(
      `Risk/reward too low (${riskReward.toFixed(1)}:1) — below ${mode} desk threshold (${minRr.toFixed(1)}:1).`
    );
  }
  if (weakAgreement) reinforcements.push("Layer agreement is mixed across desks.");
  if (timeframeCounterTrend) {
    reinforcements.push(
      mode === "day"
        ? "Intraday and weekly timeframes diverge."
        : "Daily and weekly timeframes diverge."
    );
  }

  if (hasInsufficient || (rrFail && weakAgreement && lowReadiness) || availableLayers < 4) {
    return {
      state: "blocked",
      line: "Not actionable — minimum synthesis and risk gates not met",
      reinforcements,
      rationale: deriveDecisionRationale("blocked", rationaleCtx),
      conviction: resolveTradeConvictionTier({ ...convictionBase, decisionState: "blocked" })
    };
  }
  if (strongReadiness && !rrFail && strongAgreement && goodCoverage && !counterTrend && !timeframeCounterTrend) {
    return {
      state: "actionable",
      line: "Actionable — internal gates cleared for this setup",
      reinforcements: [],
      rationale: null,
      conviction: resolveTradeConvictionTier({ ...convictionBase, decisionState: "actionable" })
    };
  }
  return {
    state: "monitor",
    line: "Final confirmation and/or risk conditions not yet satisfied",
    reinforcements,
    rationale: deriveDecisionRationale("monitor", rationaleCtx),
    conviction: resolveTradeConvictionTier({ ...convictionBase, decisionState: "monitor" })
  };
}

export type ExecutionSessionOpts = {
  tradingMode?: "day" | "swing";
  /** False only when regular NYSE session is closed (not extended-hours). Omit when unknown. */
  regularSessionOpen?: boolean | null;
  entryTimingWeak?: boolean;
};

export type ExecutionDisplayTone = "bullish" | "bearish" | "caution" | "muted";

export type ExecutionDisplay = {
  label: string;
  subline: string | null;
  headline: string;
  tone: ExecutionDisplayTone;
  /** Desk gates cleared at synthesis — may still lack a live execution window (day after close). */
  gatesCleared: boolean;
};

/** Prefer dashboard market status; fall back to composite envelope. */
export function resolveRegularSessionOpenFromSources(sources: {
  marketStatus?: Pick<MarketStatusPayload, "market"> | null;
  compositeMarketStatus?: Pick<SwingCompositeMarketStatus, "is_market_open"> | null;
}): boolean | null {
  if (sources.marketStatus != null) {
    return isRegularSessionOpen(sources.marketStatus);
  }
  if (sources.compositeMarketStatus != null) {
    return sources.compositeMarketStatus.is_market_open;
  }
  return null;
}

export function regularSessionOpenFromCompositePayload(
  body: Record<string, unknown> | null | undefined
): boolean | null {
  const raw = body?.market_status;
  if (!raw || typeof raw !== "object") return null;
  const open = (raw as { is_market_open?: unknown }).is_market_open;
  return typeof open === "boolean" ? open : null;
}

export function resolveExecutionDisplay(
  state: TradeDecisionState,
  opts?: ExecutionSessionOpts
): ExecutionDisplay {
  const mode = opts?.tradingMode ?? "swing";
  const sessionClosed = opts?.regularSessionOpen === false;

  if (state === "actionable" && sessionClosed) {
    if (mode === "day") {
      return {
        label: "Session closed",
        subline: "Day setup from earlier session — re-evaluates at next open",
        headline: "→ Session closed — no live execution window",
        tone: "caution",
        gatesCleared: false
      };
    }
    const label = opts?.entryTimingWeak
      ? "Actionable · For next market open · timing caution"
      : "Actionable · For next market open";
    return {
      label,
      subline: "Gates cleared — valid through next regular open; review scenario before the open",
      headline: "→ Actionable setup — for next market open",
      tone: "bullish",
      gatesCleared: true
    };
  }

  if (state === "actionable") {
    const label = opts?.entryTimingWeak ? "Actionable — entry timing caution" : "Actionable";
    return {
      label,
      subline:
        mode === "swing"
          ? "Gates cleared — review levels and scenario before acting"
          : "Gates cleared — review levels and scenario",
      headline: "→ Actionable setup — gates cleared",
      tone: "bullish",
      gatesCleared: true
    };
  }

  if (state === "monitor") {
    return {
      label: "Not actionable yet",
      subline: null,
      headline: "→ Setup is forming — waiting on final confirmation",
      tone: "muted",
      gatesCleared: false
    };
  }

  return {
    label: "Not actionable",
    subline: null,
    headline: "→ Setup not ready — minimum gates not met",
    tone: "muted",
    gatesCleared: false
  };
}

export function executionDisplayTone(
  state: TradeDecisionState,
  opts?: ExecutionSessionOpts
): ExecutionDisplayTone {
  return resolveExecutionDisplay(state, opts).tone;
}

/** Execution readiness — separate from layer alignment strength. */
export function executionReadinessLabel(
  state: TradeDecisionState,
  opts?: ExecutionSessionOpts
): string {
  return resolveExecutionDisplay(state, opts).label;
}

export function executionHeadline(
  state: TradeDecisionState,
  opts?: ExecutionSessionOpts
): string {
  return resolveExecutionDisplay(state, opts).headline;
}

/** @deprecated Use {@link executionHeadline} */
export const actionableHeadline = executionHeadline;

function executionBlockedByRiskReward(decision: TradeDecision): boolean {
  if (decision.rationale?.category === "risk_reward") return true;
  return (decision.reinforcements ?? []).some((line) => /risk\/?reward/i.test(line));
}

function riskRewardRatioFromDecision(decision: TradeDecision): number | null {
  const fromRationale = decision.rationale?.text?.match(/risk\/?reward too low \(([\d.]+):1\)/i);
  if (fromRationale?.[1]) {
    const n = Number.parseFloat(fromRationale[1]);
    if (Number.isFinite(n)) return n;
  }
  for (const line of decision.reinforcements ?? []) {
    const m = line.match(/risk\/?reward too low \(([\d.]+):1\)/i);
    if (m?.[1]) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** When layer alignment is strong but execution is withheld (especially poor R/R). */
export function strongSetupExecutionBridgeLine(
  state: TradeDecisionState,
  layersAligned: number,
  layersTotal: number,
  setupBias: SignalsSetupBias | undefined,
  decision: TradeDecision
): string | null {
  if (setupBias === "Neutral" || state === "actionable") return null;
  const tier = resolveAlignmentDisplayTier({ layersAligned, layersTotal });
  if (tier !== "actionable") return null;
  if (!executionBlockedByRiskReward(decision)) return null;
  const rr = riskRewardRatioFromDecision(decision);
  if (rr != null && Number.isFinite(rr)) {
    return `Strong setup quality — execution blocked by risk/reward (${rr.toFixed(1)}:1).`;
  }
  return "Strong setup quality — execution blocked by risk/reward at this price.";
}

/** When alignment is strong but execution gates are not cleared yet. */
export function executionProgressHint(
  state: TradeDecisionState,
  layersAligned: number,
  layersTotal: number,
  setupBias?: SignalsSetupBias,
  decision?: TradeDecision
): string | null {
  if (state === "actionable") return null;
  if (setupBias === "Neutral") return null;
  if (decision) {
    const bridge = strongSetupExecutionBridgeLine(
      state,
      layersAligned,
      layersTotal,
      setupBias,
      decision
    );
    if (bridge) return bridge;
  }
  const tier = resolveAlignmentDisplayTier({ layersAligned, layersTotal });
  if (tier === "actionable" && state === "monitor") {
    return "One condition remains before this becomes actionable";
  }
  return null;
}

/** One-line primary gate copy (merges desk R/R threshold into rationale when applicable). */
export function primaryGateDisplayText(decision: TradeDecision): string | null {
  const text = decision.rationale?.text?.trim();
  if (!text) return null;
  if (decision.rationale?.category === "risk_reward") {
    const deskRr = (decision.reinforcements ?? []).find(isRiskRewardBullet);
    if (deskRr) return mergeRiskRewardWhyNotLine(text, deskRr);
  }
  return text;
}

/** Primary gate sentence when execution is withheld (from trade-decision rationale). */
export function primaryExecutionBlockerLine(decision: TradeDecision): string | null {
  return primaryGateDisplayText(decision);
}

/** Label for the execution disclosure control under “Not actionable yet”. */
export function executionDetailToggleLabel(
  state: TradeDecisionState,
  executionHint: string | null
): string | null {
  if (state === "actionable") return null;
  if (executionHint) return executionHint;
  if (state === "monitor" || state === "blocked") return "See what is blocking execution";
  return null;
}

function pushUniqueBullet(out: string[], line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  const key = trimmed.slice(0, 48);
  if (!out.some((b) => b.slice(0, 48) === key || b.includes(trimmed) || trimmed.includes(b))) {
    out.push(trimmed);
  }
}

function isRiskRewardBullet(line: string): boolean {
  return /risk\/?reward too low/i.test(line);
}

/** One R/R bullet: desk threshold + structured-scenario framing (avoid duplicate lines). */
function mergeRiskRewardWhyNotLine(rationaleText: string, deskThresholdLine: string): string {
  const deskPart = deskThresholdLine.match(/below .+?\(\d+(?:\.\d+)?:1\)\.?/i);
  const rrPrefix = rationaleText.match(/^Risk\/reward too low \([^)]+\)/i)?.[0];
  if (!rrPrefix || !deskPart) return rationaleText;
  return `${rrPrefix} — ${deskPart[0].replace(/\.$/, "")}; does not meet internal thresholds for structured scenario building.`;
}

/** Short label for the primary execution gate (matches KPI → panel scroll target). */
export function decisionGateCategoryLabel(category: DecisionRationaleCategory): string {
  switch (category) {
    case "data_insufficient":
      return "Data coverage";
    case "risk_reward":
      return "Risk / reward";
    case "confirmation":
      return "Layer confirmation";
    case "regime":
      return "Regime / macro";
    default:
      return "Signal readiness";
  }
}

/** Reinforcement lines that add detail beyond the primary rationale sentence. */
export function executionSupportingGates(decision: TradeDecision): string[] {
  const primary = primaryGateDisplayText(decision) ?? decision.rationale?.text?.trim() ?? "";
  return (decision.reinforcements ?? []).filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (decision.rationale?.category === "risk_reward" && isRiskRewardBullet(t)) return false;
    if (primary && (t === primary || primary.includes(t) || t.includes(primary))) return false;
    return true;
  });
}

/** Gate-focused bullets for “Why not actionable?” — distinct from causal layer narrative. */
export function buildWhyNotBullets(
  decision: TradeDecision,
  previewLayers: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  max = 3,
  /** @deprecated Prefer causal panel on page — only used when no causal panel is visible. */
  causalBullets?: string[] | null,
  /** When true, omit per-layer preview lines (causal narrative covers layer context). */
  skipLayerPreview = false
): string[] {
  if (causalBullets && causalBullets.length > 0) {
    return causalBullets.slice(0, max);
  }
  const out: string[] = [];
  if (decision.rationale?.text) {
    if (decision.rationale.category === "risk_reward") {
      const deskRr = (decision.reinforcements ?? []).find(isRiskRewardBullet);
      pushUniqueBullet(out, deskRr ? mergeRiskRewardWhyNotLine(decision.rationale.text, deskRr) : decision.rationale.text);
    } else {
      pushUniqueBullet(out, decision.rationale.text);
    }
  }
  for (const line of decision.reinforcements ?? []) {
    if (out.length >= max) break;
    if (decision.rationale?.category === "risk_reward" && isRiskRewardBullet(line)) continue;
    pushUniqueBullet(out, line);
  }
  if (!skipLayerPreview) {
    for (const row of previewLayers) {
      if (out.length >= max) break;
      const line = buildLayerInsightLine(row, bias);
      pushUniqueBullet(out, `${row.name}: ${line}`);
    }
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
