/**
 * Inline preview panels for Scenario Builder (layer breakdown + session context).
 */

import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import { COMPOSITE_LAYER_KEYS, compositeToSignalsLayerRows } from "@/lib/signals/composite-layer-rows";
import {
  alignedLayersFromAlignmentRatio,
  layerPolarity,
  resolveCompositeLayerAlignment,
  type SignalsLayerPolarity,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { ScenarioBuilderSurface } from "@/lib/scenario/scenario-builder-drill-down";
import { contextualSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioExecutionTier } from "@/lib/scenario/scenario-readiness";

/** Short direction tag for layer breakdown (ties to setup bias). */
export function layerDirectionContextLabel(polarity: SignalsLayerPolarity): string {
  switch (polarity) {
    case "supportive":
      return "supportive";
    case "blocking":
      return "weak";
    case "mixed":
      return "mixed";
    default:
      return "neutral";
  }
}

export function humanizeScenarioGateReason(reason: string): string {
  const key = reason.trim().toLowerCase();
  if (key === "market_closed") {
    return "Market is closed — execution planning unavailable";
  }
  if (key === "outside_rth") {
    return "Outside regular session — execution planning limited";
  }
  if (key === "stale_gap") {
    return "Gap data is stale — execution planning paused";
  }
  return reason.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Matches ``DEFAULT_BASE_WEIGHTS`` in composite scorer (for weighted X/6 row marks). */
export const LAYER_ALIGNMENT_WEIGHT: Record<string, number> = {
  technical: 0.3,
  news: 0.18,
  sector: 0.12,
  macro: 0.16,
  geopolitical: 0.12,
  internals: 0.12
};

export type LayerPreviewMark = "aligned" | "partial" | "conflicted" | "unavailable";

export type ScenarioPreviewPanelData = {
  symbol: string;
  mode: "day" | "swing";
  setupBias: SignalsSetupBias;
  layerRows: SignalsLayerRowInput[];
  alignmentRatio?: number | null;
  conflictedLayerKeys?: string[];
  sessionLines: string[];
  loadingLayers: boolean;
  evidenceHref: string;
};

export function scenarioEvidenceHref(
  symbol: string,
  surface: ScenarioBuilderSurface,
  mode: "day" | "swing"
): string {
  const ref =
    surface === "watchlist"
      ? "watchlist"
      : surface === "scanner"
        ? "scanner"
        : surface === "evidence"
          ? "watchlist"
          : "watchlist";
  return `${contextualSignalsHref(symbol, ref, mode)}#evidence`;
}

export function buildSessionContextLines(args: {
  gapIntel?: GapIntelSnapshot | null;
  gapGate?: ScenarioInput["gap_intel_gate"];
  executionTier: ScenarioExecutionTier;
  mode: "day" | "swing";
}): string[] {
  const lines: string[] = [];
  const gi = args.gapIntel;

  if (gi) {
    const dir = gi.gap.direction;
    if (dir === "NONE" || dir === "UNKNOWN") {
      lines.push("No meaningful gap detected for this session.");
    } else {
      const pct =
        typeof gi.gap.gap_size_pct === "number" && Number.isFinite(gi.gap.gap_size_pct)
          ? `${gi.gap.gap_size_pct >= 0 ? "+" : ""}${gi.gap.gap_size_pct.toFixed(2)}%`
          : null;
      lines.push(`Gap ${dir === "UP" ? "up" : "down"}${pct ? ` (${pct})` : ""} · ${gi.gap.status || "in play"}`);
    }
    if (gi.liquidity?.is_high_liquidity === false) {
      lines.push("Volume / liquidity: below high-liquidity threshold.");
    } else if (gi.liquidity?.is_high_liquidity === true) {
      lines.push("Volume / liquidity: high-liquidity names only.");
    }
    lines.push(`Session phase: ${gi.phase.label || gi.phase.state}`);
    if (gi.flags.market_closed) {
      lines.push("Market is closed — intraday structure may be incomplete.");
    }
    const sb = gi.scenario_builder;
    if (sb.state === "DISABLED" && sb.reasons.length > 0) {
      lines.push(humanizeScenarioGateReason(sb.reasons[0]));
    } else if (sb.state === "LIMITED" && sb.reasons.length > 0) {
      lines.push(`Limited: ${humanizeScenarioGateReason(sb.reasons[0])}`);
    }
  } else if (args.gapGate?.reasons?.length) {
    lines.push(humanizeScenarioGateReason(args.gapGate.reasons[0]));
  } else {
    lines.push("Gap intelligence not loaded for this symbol yet.");
  }

  if (args.executionTier === "session_limited") {
    lines.push(
      args.mode === "day"
        ? "Execution window: session-limited (day mode needs open-session structure)."
        : "Execution window: session-limited for this read."
    );
  }

  return lines;
}

export function buildScenarioPreviewPanelData(args: {
  symbol: string;
  mode: "day" | "swing";
  setupBias: SignalsSetupBias;
  composite?: Record<string, unknown> | null;
  layerRows?: SignalsLayerRowInput[] | null;
  gapIntel?: GapIntelSnapshot | null;
  gapGate?: ScenarioInput["gap_intel_gate"];
  executionTier: ScenarioExecutionTier;
  surface: ScenarioBuilderSurface;
  loadingLayers?: boolean;
  alignmentRatio?: number | null;
}): ScenarioPreviewPanelData {
  const sym = args.symbol.trim().toUpperCase();
  const rows =
    args.layerRows && args.layerRows.length > 0
      ? args.layerRows
      : compositeToSignalsLayerRows(args.composite);

  const conflictedLayerKeys = conflictedLayersFromComposite(args.composite);

  return {
    symbol: sym,
    mode: args.mode,
    setupBias: args.setupBias,
    layerRows: rows,
    alignmentRatio: args.alignmentRatio,
    conflictedLayerKeys,
    sessionLines: buildSessionContextLines({
      gapIntel: args.gapIntel,
      gapGate: args.gapGate,
      executionTier: args.executionTier,
      mode: args.mode
    }),
    loadingLayers: Boolean(args.loadingLayers),
    evidenceHref: scenarioEvidenceHref(sym, args.surface, args.mode)
  };
}

export function layerAlignedWithBias(row: SignalsLayerRowInput, bias: SignalsSetupBias): boolean {
  if (bias === "Neutral") {
    return row.status === "Neutral" || row.status === "As of close";
  }
  return layerPolarity(row, bias) === "supportive";
}

function conflictedLayersFromComposite(composite?: Record<string, unknown> | null): string[] {
  const raw = composite?.conflicted_layers;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
    .filter(Boolean);
}

/**
 * Per-layer marks for Scenario Builder preview — when ``alignmentRatio`` is set, the
 * headline X/6 is weighted; cap ✅ marks at that count (highest-weight non-conflicted layers).
 */
export function resolveLayerPreviewMarks(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  opts?: { alignmentRatio?: number | null; conflictedLayerKeys?: readonly string[] | null }
): Record<string, LayerPreviewMark> {
  const out: Record<string, LayerPreviewMark> = {};
  for (const row of rows) {
    if (row.sectorCachePending || row.status === "Unavailable") {
      out[row.key] = "unavailable";
    }
  }

  const ar = opts?.alignmentRatio;
  if (ar == null || !Number.isFinite(ar)) {
    for (const row of rows) {
      if (out[row.key]) continue;
      out[row.key] = layerAlignedWithBias(row, bias) ? "aligned" : "conflicted";
    }
    return out;
  }

  const target = alignedLayersFromAlignmentRatio(ar) ?? 0;
  const conflicted = new Set((opts?.conflictedLayerKeys ?? []).map((k) => k.toLowerCase()));

  for (const row of rows) {
    if (out[row.key]) continue;
    if (conflicted.has(row.key.toLowerCase())) {
      out[row.key] = "conflicted";
    }
  }

  type Candidate = { key: string; weight: number; order: number };
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (out[row.key]) continue;
    const layerKey = row.key.toLowerCase();
    const order = COMPOSITE_LAYER_KEYS.indexOf(layerKey as (typeof COMPOSITE_LAYER_KEYS)[number]);
    candidates.push({
      key: row.key,
      weight: LAYER_ALIGNMENT_WEIGHT[layerKey] ?? 0.1,
      order: order >= 0 ? order : 99
    });
  }

  candidates.sort((a, b) => b.weight - a.weight || a.order - b.order);
  const alignedKeys = new Set(candidates.slice(0, target).map((c) => c.key));

  for (const row of rows) {
    if (out[row.key]) continue;
    out[row.key] = alignedKeys.has(row.key) ? "aligned" : "partial";
  }
  return out;
}

export function layerPreviewMarkGlyph(mark: LayerPreviewMark): string {
  switch (mark) {
    case "aligned":
      return "✅";
    case "partial":
      return "○";
    case "conflicted":
      return "❌";
    default:
      return "—";
  }
}

export function layerPreviewSummary(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias,
  alignmentRatio?: number | null
): string {
  const { displayLine } = resolveCompositeLayerAlignment({ rows, bias, alignmentRatio });
  if (bias === "Neutral") {
    return `${displayLine} — no directional pressure dominates`;
  }
  return `${displayLine} — layers aligned with ${bias.toLowerCase()} bias`;
}
