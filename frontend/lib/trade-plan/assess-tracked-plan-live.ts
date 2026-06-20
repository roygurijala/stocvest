import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { buildScenarioPlanningBundle } from "@/lib/scenario/scenario-planning-bundle";
import { parseApiDecisionState } from "@/lib/signal-evidence/risk-stack-present";
import type { SignalsSetupBias } from "@/lib/signals-page-present";
import {
  buildLiveAssessmentFromDeepDive,
  resolveLiveVsPlanDiff,
  type LiveVsPlanDiff
} from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";

function biasToSetupBias(bias: TrackedPlan["bias"]): SignalsSetupBias {
  if (bias === "Bullish") return "Bullish";
  if (bias === "Bearish") return "Bearish";
  return "Neutral";
}

/** Live thesis/trigger read for a tracked plan from a composite payload. */
export function assessTrackedPlanFromComposite(
  plan: TrackedPlan,
  composite: Record<string, unknown> | null | undefined
): LiveVsPlanDiff {
  const insufficient = composite == null || isInsufficientCompositeResponse(composite);
  if (insufficient) {
    const live = buildLiveAssessmentFromDeepDive({
      currentPrice: null,
      setupBias: biasToSetupBias(plan.bias),
      decisionState: null,
      executionActionable: null,
      entryZoneQuality: plan.entryZoneQuality ?? null,
      entryLow: plan.levels.entryLow,
      entryHigh: plan.levels.entryHigh,
      currentRr: null,
      isInsufficient: true,
      layersAligned: plan.layersAligned ?? null,
      layersTotal: plan.layersTotal ?? null
    });
    return resolveLiveVsPlanDiff(plan, live, plan.deskMinRr);
  }

  const bundle = buildScenarioPlanningBundle({
    symbol: plan.symbol,
    tradingMode: plan.mode,
    composite
  });
  const ref = bundle.input.reference;
  const decisionState = parseApiDecisionState(composite.decision_state);
  const executionActionable =
    typeof composite.execution_actionable === "boolean" ? composite.execution_actionable : null;
  const entryZoneQuality =
    typeof composite.entry_zone_quality === "string"
      ? composite.entry_zone_quality
      : plan.entryZoneQuality ?? null;

  const live = buildLiveAssessmentFromDeepDive({
    currentPrice: typeof ref.current_price === "number" ? ref.current_price : plan.levels.priceAtCommit,
    setupBias: bundle.setupBias,
    decisionState,
    executionActionable,
    entryZoneQuality,
    entryLow: typeof ref.entry_low === "number" ? ref.entry_low : plan.levels.entryLow,
    entryHigh: typeof ref.entry_high === "number" ? ref.entry_high : plan.levels.entryHigh,
    currentRr: typeof bundle.input.risk_reward === "number" ? bundle.input.risk_reward : null,
    isInsufficient: false,
    layersAligned: bundle.readiness.layersAligned ?? plan.layersAligned ?? null,
    layersTotal: bundle.readiness.layersTotal ?? plan.layersTotal ?? null
  });

  return resolveLiveVsPlanDiff(plan, live, plan.deskMinRr);
}
