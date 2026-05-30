import type { AssistantPageContext } from "@/lib/assistant/types";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import { buildExecutionHeaderHint } from "@/lib/signals-desk-kpi-present";
import {
  executionReadinessLabel,
  formatSignalsAlignmentDisplayLine,
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";

/** Desk fields visible on Signals command bar + Setup panels — forwarded to the assistant. */
export function enrichSignalsDeskAssistantContext(
  base: AssistantPageContext,
  input: {
    setupBias: SignalsSetupBias;
    rows: SignalsLayerRowInput[];
    decision: TradeDecision;
    alignmentRatio: number | null | undefined;
    maturationState?: string | null;
    maturationLabel?: string | null;
    tradingMode: "day" | "swing";
    regularSessionOpen?: boolean | null;
  }
): AssistantPageContext {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.setupBias,
    alignmentRatio: input.alignmentRatio
  });
  const reinforcements = (input.decision.reinforcements ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    ...base,
    setup_bias: input.setupBias,
    alignment_display: formatSignalsAlignmentDisplayLine(
      alignment,
      input.setupBias,
      input.maturationState
    ),
    execution_readiness_label: executionReadinessLabel(input.decision.state, {
      tradingMode: input.tradingMode,
      regularSessionOpen: input.regularSessionOpen
    }),
    execution_hint:
      buildExecutionHeaderHint(
        input.decision,
        input.tradingMode,
        alignment.aligned,
        alignment.total,
        input.setupBias,
        input.regularSessionOpen
      ) ?? undefined,
    decision_reinforcements: reinforcements.length > 0 ? reinforcements : undefined,
    maturation_label: input.maturationLabel?.trim() || undefined,
    conviction_tier: input.decision.conviction?.tier,
    conviction_label: input.decision.conviction?.label,
    conviction_summary: input.decision.conviction?.summaryLine
  };
}
