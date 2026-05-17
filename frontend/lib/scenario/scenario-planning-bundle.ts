/**
 * Single source of truth for Scenario Builder input + readiness across surfaces.
 *
 * Priority: composite evidence (same as Signals) → maturation summary → snapshot quote only.
 */

import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import type { SnapshotPayload } from "@/lib/api/market";
import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import {
  compositeToSignalsLayerRows,
  deriveSetupBiasFromComposite,
  maturationBiasToSetupBias
} from "@/lib/signals/composite-layer-rows";
import {
  buildSignalsPageDecision,
  countLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  augmentScenarioInputWithGapIntel,
  buildScenarioInputFromCompositeContext,
  buildWatchlistScenarioInput,
  setupBiasToScenarioDirection
} from "@/lib/scenario/scenario-input-present";
import type { ScenarioReadinessContext } from "@/lib/scenario/scenario-readiness";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import { parseSwingCompositeInsight } from "@/lib/signal-evidence";

export type ScenarioPlanningBundle = {
  input: ScenarioInput;
  readiness: ScenarioReadinessContext;
  setupBias: SignalsSetupBias;
  /** True when entry/stop/target came from composite evidence, not snapshot-only. */
  fromComposite: boolean;
};

export type BuildScenarioPlanningBundleArgs = {
  symbol: string;
  tradingMode: "day" | "swing";
  composite?: Record<string, unknown> | null;
  snapshot?: SnapshotPayload | null;
  gapIntel?: GapIntelSnapshot | null;
  maturation?: WatchlistMaturationRow | null;
  /** When Signals page already computed decision, pass through for full-tier gating. */
  decisionState?: TradeDecisionState | null;
  /** Optional override (Signals page layer summary). */
  setupBias?: SignalsSetupBias | null;
  layerRows?: SignalsLayerRowInput[] | null;
};

function snapshotQuoteBullish(snapshot: SnapshotPayload | null | undefined): boolean | null {
  if (!snapshot) return null;
  const ch = snapshot.change_percent;
  if (typeof ch === "number" && Number.isFinite(ch)) {
    if (ch > 0.05) return true;
    if (ch < -0.05) return false;
  }
  return null;
}

function hasStructuralReference(input: ScenarioInput): boolean {
  const r = input.reference;
  return Boolean(
    (typeof r.entry_low === "number" && r.entry_low > 0) ||
      (typeof r.entry_high === "number" && r.entry_high > 0) ||
      (typeof r.stop === "number" && r.stop > 0) ||
      (typeof r.target_1 === "number" && r.target_1 > 0)
  );
}

export function buildScenarioPlanningBundle(args: BuildScenarioPlanningBundleArgs): ScenarioPlanningBundle {
  const sym = args.symbol.trim().toUpperCase();
  const comp =
    args.composite != null && !isInsufficientCompositeResponse(args.composite)
      ? args.composite
      : null;

  const layerRows =
    args.layerRows && args.layerRows.length > 0 ? args.layerRows : compositeToSignalsLayerRows(comp);

  const setupBias =
    args.setupBias ??
    maturationBiasToSetupBias(args.maturation?.bias) ??
    deriveSetupBiasFromComposite(comp, layerRows);

  let input: ScenarioInput;
  let fromComposite = false;

  if (comp) {
    input = buildScenarioInputFromCompositeContext({
      symbol: sym,
      tradingMode: args.tradingMode,
      setupBias,
      composite: comp,
      snapshot: args.snapshot ?? undefined
    });
    fromComposite = true;
  } else {
    input = buildWatchlistScenarioInput({
      symbol: sym,
      mode: args.tradingMode,
      snapshot: args.snapshot ?? undefined,
      quoteBullish: snapshotQuoteBullish(args.snapshot)
    });
    input = {
      ...input,
      direction: setupBiasToScenarioDirection(setupBias)
    };
  }

  input = augmentScenarioInputWithGapIntel(input, args.gapIntel);

  const { aligned, total } =
    layerRows.length > 0
      ? countLayerAlignment(layerRows, setupBias)
      : {
          aligned: args.maturation?.layers_aligned ?? 0,
          total: args.maturation?.layers_total ?? 6
        };

  let decisionState = args.decisionState ?? null;
  if (!decisionState && comp && layerRows.length > 0) {
    const insight = parseSwingCompositeInsight(comp);
    const rr =
      typeof comp.risk_reward === "number" && Number.isFinite(comp.risk_reward)
        ? comp.risk_reward
        : typeof insight?.risk_reward === "number"
          ? insight.risk_reward
          : 1.5;
    const ar = typeof comp.alignment_ratio === "number" ? comp.alignment_ratio : null;
    const score =
      typeof insight?.signal_score === "number" && Number.isFinite(insight.signal_score)
        ? insight.signal_score
        : 50;
    decisionState = buildSignalsPageDecision({
      bias: setupBias,
      rows: layerRows,
      signalScore: score,
      alignmentRatio: ar,
      riskReward: rr,
      rrWarning: Boolean(comp.rr_warning) || rr < 2,
      isComplete: comp.is_complete !== false
    }).state;
  }

  const readiness: ScenarioReadinessContext = {
    symbol: sym,
    mode: args.tradingMode,
    setupBias,
    layerRows: layerRows.length > 0 ? layerRows : undefined,
    layersAligned: aligned,
    layersTotal: total,
    decisionState,
    maturationState: args.maturation?.state ?? null,
    readinessLabel: args.maturation?.readiness_label ?? null,
    hasReferenceLevels: fromComposite ? hasStructuralReference(input) : Boolean(input.reference.current_price)
  };

  return { input, readiness, setupBias, fromComposite };
}
