/**
 * Scenario Builder capability gating — gate output, not access.
 *
 * The button is always clickable. The modal shows preview / anticipation /
 * or the full planning sheet depending on setup readiness (maturation,
 * layer alignment, decision state) and structural data completeness.
 */

import { isEligibleForScenario } from "@/lib/scenario/eligibility";
import { pickMissingConfirmationLayers } from "@/lib/signal-evidence/evidence-card-present";
import {
  countLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";

export type ScenarioBuilderCapability = "preview" | "building_soon" | "full";

export type ScenarioReadinessContext = {
  symbol: string;
  mode: "swing" | "day";
  /** Setup bias for directional preview copy only (no prices). */
  setupBias?: SignalsSetupBias | null;
  layerRows?: SignalsLayerRowInput[];
  layersAligned?: number | null;
  layersTotal?: number | null;
  /** Watchlist maturation or similar lifecycle label. */
  maturationState?: string | null;
  /** Signals page decision when available. */
  decisionState?: TradeDecisionState | null;
  /** True when reference levels exist on the payload — qualitative only in UI. */
  hasReferenceLevels?: boolean;
  readinessLabel?: string | null;
};

export type ScenarioReadinessResolved = {
  capability: ScenarioBuilderCapability;
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
const NEAR_ACTIONABLE_ALIGNED = 3;

function normalizeMaturation(state: string | null | undefined): string {
  return (state ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function biasToDirectionalLabel(bias: SignalsSetupBias | null | undefined): string | null {
  if (bias === "Bullish") return "Long bias";
  if (bias === "Bearish") return "Short bias";
  if (bias === "Neutral") return "Neutral / no directional scenario";
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
    const { aligned } = countLayerAlignment(rows, bias);
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

/**
 * Resolve which modal experience to show. Does not disable the button.
 */
export function resolveScenarioBuilderCapability(
  ctx: ScenarioReadinessContext,
  input: ScenarioInput
): ScenarioReadinessResolved {
  const structural = isEligibleForScenario(input);
  const gapIntelBlocked = Boolean(input.gap_intel_gate?.scenario_builder_state === "DISABLED");
  const { aligned, total, missing } = countAlignment(ctx);
  const maturation = normalizeMaturation(ctx.maturationState);
  const decision = ctx.decisionState ?? null;
  const directionalLabel = biasToDirectionalLabel(ctx.setupBias ?? null);
  const maturationLabel = maturation ? maturation.replace(/_/g, " ") : null;
  const refLevels = ctx.hasReferenceLevels ?? hasReferenceLevels(input);

  const setupActionable =
    decision === "actionable" || maturation === "actionable";

  if (setupActionable && structural.eligible && !gapIntelBlocked) {
    return {
      capability: "full",
      aligned,
      total,
      missingLayers: missing,
      directionalLabel,
      maturationLabel,
      structurallyComplete: true,
      gapIntelBlocked: false
    };
  }

  const nearActionable =
    aligned >= NEAR_ACTIONABLE_ALIGNED ||
    maturation === "developing" ||
    maturation === "re_evaluating" ||
    (decision === "monitor" && aligned >= NEAR_ACTIONABLE_ALIGNED);

  if (nearActionable && !gapIntelBlocked) {
    return {
      capability: "building_soon",
      aligned,
      total,
      missingLayers: missing,
      directionalLabel,
      maturationLabel,
      structurallyComplete: structural.eligible,
      gapIntelBlocked: false
    };
  }

  return {
    capability: "preview",
    aligned,
    total,
    missingLayers: missing,
    directionalLabel,
    maturationLabel,
    structurallyComplete: structural.eligible,
    gapIntelBlocked
  };
}

/** User-facing missing layer bullets; falls back when watchlist has no row detail. */
export function defaultMissingBullets(resolved: ScenarioReadinessResolved): string[] {
  if (resolved.missingLayers.length > 0) {
    return resolved.missingLayers.map((name) => {
      if (name === "Internals") return "Participation / breadth confirmation";
      if (name === "Technical") return "Trend structure confirmation";
      return `${name} confirmation`;
    });
  }
  if (resolved.aligned < resolved.total) {
    return ["Layer alignment across the six-layer stack", "Risk and confirmation gates"];
  }
  return ["Setup qualification on this symbol"];
}
