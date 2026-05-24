import { formatLayersFromActionableHint } from "@/lib/alignment-display-tier";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import {
  decisionGateCategoryLabel,
  executionReadinessLabel,
  executionSupportingGates,
  formatLayerForceNames,
  formatSignalsAlignmentDisplayLine,
  groupLayersByForce,
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

/** One-line proof for command-bar bias chip (layer counts / names). */
export function buildBiasHeaderProof(
  rows: SignalsLayerRowInput[],
  bias: SignalsSetupBias
): string | null {
  const groups = groupLayersByForce(rows, bias);
  const supportN = groups.withBias.length;
  const opposeN = groups.againstOrMixed.length;
  const neutralN = groups.noEdge.length;

  if (bias === "Neutral") {
    if (supportN === 0 && opposeN === 0) return `${neutralN} neutral layers`;
    return `${supportN} bullish · ${opposeN} bearish${neutralN > 0 ? ` · ${neutralN} neutral` : ""}`;
  }
  if (supportN === 0 && opposeN === 0) return `${neutralN} neutral · none opposing`;
  const names = formatLayerForceNames(groups.withBias);
  if (names !== "—" && names.length <= 36) {
    return `${supportN} layers: ${names}`;
  }
  const parts = [`${supportN} support`];
  if (opposeN > 0) parts.push(`${opposeN} oppose`);
  if (neutralN > 0) parts.push(`${neutralN} neutral`);
  return parts.join(" · ");
}

/** Short execution hint for command bar — avoids repeating full rationale paragraph. */
export function buildExecutionHeaderHint(
  decision: TradeDecision,
  mode: "day" | "swing"
): string | null {
  if (decision.state === "actionable") {
    return "Gates cleared — review levels and scenario";
  }
  const supporting = executionSupportingGates(decision);
  if (supporting.length > 0) {
    const category = decision.rationale
      ? decisionGateCategoryLabel(decision.rationale.category)
      : null;
    const lead = supporting[0].replace(/\.$/, "");
    if (category && !lead.toLowerCase().includes(category.toLowerCase())) {
      return `${lead} · ${category}`;
    }
    return lead;
  }
  const blocker = primaryExecutionBlockerLine(decision);
  if (blocker && blocker.length <= 88) return blocker;
  if (decision.rationale?.category) {
    return decisionGateCategoryLabel(decision.rationale.category);
  }
  const min = minRiskRewardForVerdict(mode);
  if (decision.rationale?.category === "risk_reward") {
    return `R/R below desk minimum (needs ≥ ${min.toFixed(1)} : 1)`;
  }
  return null;
}

export type SignalsDeskVerdictBundle = {
  items: SignalsDeskKpiItem[];
  biasProof: string | null;
  executionHint: string | null;
};

export function buildSignalsDeskVerdict(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  tradingMode: "day" | "swing";
  alignmentRatio?: number | null;
  maturationState?: string | null;
}): SignalsDeskVerdictBundle {
  const items = buildSignalsDeskKpiItems(input);
  return {
    items,
    biasProof: buildBiasHeaderProof(input.rows, input.bias),
    executionHint: buildExecutionHeaderHint(input.decision, input.tradingMode)
  };
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
