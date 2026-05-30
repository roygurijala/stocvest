/**
 * Scenario Builder capability gating — gate output, not access.
 *
 * Two axes (always computed together):
 *   - Setup readiness: alignment / maturation / confirmations
 *   - Execution readiness: gap/session gates + structural reference levels
 *
 * The button is always clickable. `capability` selects preview vs full sheet;
 * both axes are always shown in the preview modal.
 */

import {
  ACTIONABLE_ALIGNED_MIN,
  DEVELOPING_ALIGNED_MIN,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { canOpenFullScenarioSheet } from "@/lib/scenario/eligibility";
import { pickMissingConfirmationLayers } from "@/lib/signal-evidence/evidence-card-present";
import { signalLayerDisplayName } from "@/lib/signals/layer-display-names";
import {
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { TradeDecision, TradeDecisionState } from "@/lib/signal-evidence/trade-decision";

export type ScenarioBuilderCapability = "preview" | "building_soon" | "full";

export type ScenarioSetupTier =
  | "not_aligned"
  | "developing"
  | "near_ready"
  | "actionable"
  | "invalidated";

export type ScenarioExecutionTier = "available" | "session_limited" | "structural_incomplete";

export type ScenarioReadinessContext = {
  symbol: string;
  mode: "swing" | "day";
  /** Setup bias for directional preview copy only (no prices). */
  setupBias?: SignalsSetupBias | null;
  layerRows?: SignalsLayerRowInput[];
  /** Composite engine agreement (0–1); preferred for X/6 when set. */
  alignmentRatio?: number | null;
  layersAligned?: number | null;
  layersTotal?: number | null;
  /** Watchlist maturation or similar lifecycle label. */
  maturationState?: string | null;
  /** Signals page decision when available. */
  decisionState?: TradeDecisionState | null;
  /** Full desk decision for Scenario Builder verdict banner (strict gates). */
  systemDecision?: TradeDecision | null;
  /** Setup judgment tradeability — weak band caps scenario green verdict. */
  entryTimingWeak?: boolean;
  /** Confluence VWAP conflict — caps scenario green verdict. */
  vwapConflict?: boolean;
  /** True when reference levels exist on the payload — qualitative only in UI. */
  hasReferenceLevels?: boolean;
  readinessLabel?: string | null;
};

export type ScenarioReadinessResolved = {
  capability: ScenarioBuilderCapability;
  setupTier: ScenarioSetupTier;
  executionTier: ScenarioExecutionTier;
  aligned: number;
  total: number;
  missingLayers: string[];
  directionalLabel: string | null;
  maturationLabel: string | null;
  /** Structural sheet can open (entry/stop/target math). */
  structurallyComplete: boolean;
  gapIntelBlocked: boolean;
};

const LAYER_TOTAL_DEFAULT = 6;
/** Matches watchlist maturation developing band (display-only near_ready at 4/6). */
const DEVELOPING_MIN_ALIGNED = DEVELOPING_ALIGNED_MIN;

function normalizeMaturation(state: string | null | undefined): string {
  return (state ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function biasToDirectionalLabel(bias: SignalsSetupBias | null | undefined): string | null {
  if (bias === "Bullish") return "Long bias";
  if (bias === "Bearish") return "Short bias";
  if (bias === "Neutral") return "Neutral (no directional thesis yet)";
  return null;
}

function countAlignment(
  ctx: ScenarioReadinessContext
): { aligned: number; total: number; missing: string[] } {
  const total =
    typeof ctx.layersTotal === "number" && ctx.layersTotal > 0 ? ctx.layersTotal : LAYER_TOTAL_DEFAULT;
  const bias = ctx.setupBias ?? "Neutral";
  const rows = ctx.layerRows ?? [];
  if (rows.length > 0) {
    const { aligned } = resolveSignalsLayerAlignment({
      rows,
      bias,
      alignmentRatio: ctx.alignmentRatio
    });
    const missing = pickMissingConfirmationLayers(rows, bias, 4);
    return { aligned, total, missing };
  }
  const aligned =
    typeof ctx.layersAligned === "number" && Number.isFinite(ctx.layersAligned)
      ? Math.max(0, Math.min(total, Math.round(ctx.layersAligned)))
      : 0;
  return { aligned, total, missing: [] };
}

function hasReferenceLevels(input: ScenarioInput): boolean {
  const r = input.reference;
  return Boolean(
    (typeof r.entry_low === "number" && r.entry_low > 0) ||
      (typeof r.entry_high === "number" && r.entry_high > 0) ||
      (typeof r.stop === "number" && r.stop > 0) ||
      (typeof r.target_1 === "number" && r.target_1 > 0) ||
      (typeof r.current_price === "number" && r.current_price > 0)
  );
}

function isDevelopingAlignment(aligned: number, maturation: string, decision: TradeDecisionState | null): boolean {
  return (
    aligned >= DEVELOPING_MIN_ALIGNED ||
    maturation === "developing" ||
    maturation === "re_evaluating" ||
    (decision === "monitor" && aligned >= DEVELOPING_MIN_ALIGNED)
  );
}

function resolveSetupTier(
  aligned: number,
  total: number,
  maturation: string,
  decision: TradeDecisionState | null
): ScenarioSetupTier {
  if (maturation === "invalidated") return "invalidated";
  if (decision === "actionable" || maturation === "actionable" || aligned >= ACTIONABLE_ALIGNED_MIN) {
    return "actionable";
  }
  const displayTier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: maturation
  });
  if (displayTier === "near_ready") return "near_ready";
  if (displayTier === "developing" || displayTier === "re_evaluating") return "developing";
  if (isDevelopingAlignment(aligned, maturation, decision)) return "developing";
  return "not_aligned";
}

function resolveExecutionTier(gapIntelBlocked: boolean, structurallyEligible: boolean): ScenarioExecutionTier {
  if (gapIntelBlocked) return "session_limited";
  if (!structurallyEligible) return "structural_incomplete";
  return "available";
}

/**
 * Resolve which modal experience to show. Full sheet when structurally eligible
 * (reference stop + target present). Preview when levels are missing.
 */
export function resolveScenarioBuilderCapability(
  ctx: ScenarioReadinessContext,
  input: ScenarioInput
): ScenarioReadinessResolved {
  const gapIntelBlocked = Boolean(input.gap_intel_gate?.scenario_builder_state === "DISABLED");
  const { aligned, total, missing } = countAlignment(ctx);
  const maturation = normalizeMaturation(ctx.maturationState);
  const decision = ctx.decisionState ?? null;
  const directionalLabel = biasToDirectionalLabel(ctx.setupBias ?? null);
  const maturationLabel = maturation ? maturation.replace(/_/g, " ") : null;
  const sheetReady = canOpenFullScenarioSheet(input);
  const structurallyComplete = ctx.hasReferenceLevels ?? hasReferenceLevels(input);

  const setupTier = resolveSetupTier(aligned, total, maturation, decision);
  const executionTier = resolveExecutionTier(gapIntelBlocked, sheetReady);

  const shared = {
    aligned,
    total,
    missingLayers: missing,
    directionalLabel,
    maturationLabel,
    structurallyComplete,
    gapIntelBlocked,
    setupTier,
    executionTier
  };

  if (sheetReady) {
    return {
      ...shared,
      capability: "full",
      structurallyComplete: true
    };
  }

  return {
    ...shared,
    capability: "preview"
  };
}

export function formatMissingLayerDisplayName(name: string): string {
  if (name === signalLayerDisplayName("internals")) return "Participation / breadth";
  if (name === "Technical") return "Trend structure";
  return name;
}

export type ScenarioWhyNotItem =
  | { kind: "missing_confirmations"; layers: string[] }
  | { kind: "text"; text: string };

/** Grouped why-not lines for the preview modal. */
export function scenarioWhyNotItems(resolved: ScenarioReadinessResolved): ScenarioWhyNotItem[] {
  const out: ScenarioWhyNotItem[] = [];
  if (resolved.missingLayers.length > 0) {
    out.push({
      kind: "missing_confirmations",
      layers: resolved.missingLayers.map(formatMissingLayerDisplayName)
    });
  } else if (resolved.aligned < resolved.total) {
    out.push({ kind: "text", text: "Layer alignment across the six-layer stack" });
    out.push({ kind: "text", text: "Risk and confirmation gates" });
  } else if (resolved.setupTier !== "actionable") {
    out.push({ kind: "text", text: "Setup qualification on this symbol" });
  }
  if (resolved.executionTier === "session_limited") {
    out.push({ kind: "text", text: "Execution window not open (session / gap conditions)" });
  } else if (resolved.executionTier === "structural_incomplete") {
    out.push({ kind: "text", text: "Reference levels still forming for planning math" });
  }
  return out;
}
