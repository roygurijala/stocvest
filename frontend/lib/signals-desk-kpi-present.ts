import { formatLayersFromActionableHint } from "@/lib/alignment-display-tier";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import {
  executionReadinessLabel,
  formatSignalsAlignmentDisplayLine,
  primaryExecutionBlockerLine,
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { SignalsKpiTarget } from "@/lib/signals-page-tabs";
import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";

export type SignalsDeskKpiItem = {
  target: SignalsKpiTarget;
  label: string;
  headline: string;
  subline: string | null;
  headlineTone: "bullish" | "bearish" | "caution" | "muted" | "accent";
};

function biasTone(bias: SignalsSetupBias): SignalsDeskKpiItem["headlineTone"] {
  if (bias === "Bullish") return "bullish";
  if (bias === "Bearish") return "bearish";
  return "caution";
}

/** Matches Bias KPI subline — reuse on Setup bias rationale panel. */
export function biasKpiSubline(bias: SignalsSetupBias): string {
  return bias === "Neutral" ? "No directional lean" : `${bias} read from composite`;
}

function executionSubline(decision: TradeDecision, mode: "day" | "swing"): string | null {
  if (decision.state === "actionable") {
    return "Gates cleared — review levels and scenario before acting";
  }
  const blocker = primaryExecutionBlockerLine(decision);
  if (blocker) return blocker;
  const min = minRiskRewardForVerdict(mode);
  if (decision.rationale?.category === "risk_reward") {
    return `Desk needs ≥ ${min.toFixed(1)} : 1 R/R on reference geometry`;
  }
  return null;
}

export function buildSignalsDeskKpiItems(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  tradingMode: "day" | "swing";
  alignmentRatio?: number | null;
  maturationState?: string | null;
}): SignalsDeskKpiItem[] {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio
  });
  const alignmentLine = formatSignalsAlignmentDisplayLine(
    alignment,
    input.bias,
    input.maturationState
  );
  const layersHint = formatLayersFromActionableHint(alignment.aligned, alignment.total);

  return [
    {
      target: "bias",
      label: "Bias",
      headline: input.bias,
      subline: biasKpiSubline(input.bias),
      headlineTone: biasTone(input.bias)
    },
    {
      target: "alignment",
      label: "Alignment",
      headline: alignmentLine,
      subline: layersHint,
      headlineTone: alignment.aligned >= 5 ? "bullish" : alignment.aligned >= 3 ? "caution" : "muted"
    },
    {
      target: "execution",
      label: "Execution",
      headline: executionReadinessLabel(input.decision.state),
      subline: executionSubline(input.decision, input.tradingMode),
      headlineTone: input.decision.state === "actionable" ? "bullish" : "muted"
    }
  ];
}
