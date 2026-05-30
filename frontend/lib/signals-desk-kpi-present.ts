import {
  mergeExecutionDeskHints,
  resolveExecutionWatchHint
} from "@/lib/signal-evidence/execution-watch-present";
import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import {
  decisionGateCategoryLabel,
  executionProgressHint,
  executionReadinessLabel,
  executionDisplayTone,
  resolveExecutionDisplay,
  executionSupportingGates,
  formatLayerForceNames,
  formatSignalsAlignmentDisplayLine,
  groupLayersByForce,
  primaryExecutionBlockerLine,
  resolveSignalsLayerAlignment,
  signalsAlignmentKpiSubline,
  type CompositeDirectionFields,
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

function executionSubline(
  decision: TradeDecision,
  mode: "day" | "swing",
  bias: SignalsSetupBias,
  regularSessionOpen?: boolean | null,
  setupJudgment?: SetupJudgment | null
): string | null {
  if (decision.state === "actionable") {
    const fromDisplay = resolveExecutionDisplay(decision.state, {
      tradingMode: mode,
      regularSessionOpen
    }).subline;
    if (fromDisplay) return fromDisplay;
    return "Checks passed — review levels and scenario before acting";
  }
  const blocker = primaryExecutionBlockerLine(decision);
  const watch = resolveExecutionWatchHint(setupJudgment, bias, decision.state);
  if (blocker) {
    return mergeExecutionDeskHints(blocker, watch);
  }
  const min = minRiskRewardForVerdict(mode);
  if (decision.rationale?.category === "risk_reward") {
    return mergeExecutionDeskHints(
      `Desk needs ≥ ${min.toFixed(1)} : 1 R/R on reference geometry`,
      watch
    );
  }
  return watch;
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
  mode: "day" | "swing",
  layersAligned?: number,
  layersTotal?: number,
  bias?: SignalsSetupBias,
  regularSessionOpen?: boolean | null,
  setupJudgment?: SetupJudgment | null
): string | null {
  const setupBias: SignalsSetupBias = bias ?? "Neutral";
  let primary: string | null = null;

  if (
    typeof layersAligned === "number" &&
    typeof layersTotal === "number" &&
    bias != null
  ) {
    primary = executionProgressHint(
      decision.state,
      layersAligned,
      layersTotal,
      bias,
      decision
    );
  }
  if (!primary && decision.state === "actionable") {
    primary =
      resolveExecutionDisplay(decision.state, {
        tradingMode: mode,
        regularSessionOpen
      }).subline ?? "Checks passed — review levels and scenario";
    return primary;
  }
  if (!primary) {
    const supporting = executionSupportingGates(decision);
    if (supporting.length > 0) {
      const category = decision.rationale
        ? decisionGateCategoryLabel(decision.rationale.category)
        : null;
      const lead = supporting[0].replace(/\.$/, "");
      primary =
        category && !lead.toLowerCase().includes(category.toLowerCase())
          ? `${lead} · ${category}`
          : lead;
    }
  }
  if (!primary) {
    const blocker = primaryExecutionBlockerLine(decision);
    if (blocker && blocker.length <= 88) primary = blocker;
    else if (decision.rationale?.category) {
      primary = decisionGateCategoryLabel(decision.rationale.category);
    }
  }
  if (!primary && decision.rationale?.category === "risk_reward") {
    const min = minRiskRewardForVerdict(mode);
    primary = `R/R below desk minimum (needs ≥ ${min.toFixed(1)} : 1)`;
  }

  const watch = resolveExecutionWatchHint(setupJudgment, setupBias, decision.state);
  return mergeExecutionDeskHints(primary, watch);
}

export type SignalsDeskVerdictBundle = {
  items: SignalsDeskKpiItem[];
  biasProof: string | null;
  executionHint: string | null;
};

function alignmentHeadlineTone(
  bias: SignalsSetupBias,
  aligned: number
): SignalsDeskKpiItem["headlineTone"] {
  if (bias === "Neutral") {
    return aligned >= 5 ? "muted" : aligned >= 3 ? "caution" : "muted";
  }
  return aligned >= 5 ? "bullish" : aligned >= 3 ? "caution" : "muted";
}

export function buildSignalsDeskVerdict(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  tradingMode: "day" | "swing";
  alignmentRatio?: number | null;
  maturationState?: string | null;
  regularSessionOpen?: boolean | null;
  compositeDirection?: CompositeDirectionFields | null;
  setupJudgment?: SetupJudgment | null;
}): SignalsDeskVerdictBundle {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio,
    compositeDirection: input.compositeDirection
  });
  const items = buildSignalsDeskKpiItems(input);
  return {
    items,
    biasProof: buildBiasHeaderProof(input.rows, input.bias),
    executionHint: buildExecutionHeaderHint(
      input.decision,
      input.tradingMode,
      alignment.aligned,
      alignment.total,
      input.bias,
      input.regularSessionOpen,
      input.setupJudgment
    )
  };
}

export function buildSignalsDeskKpiItems(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  tradingMode: "day" | "swing";
  alignmentRatio?: number | null;
  maturationState?: string | null;
  regularSessionOpen?: boolean | null;
  compositeDirection?: CompositeDirectionFields | null;
  setupJudgment?: SetupJudgment | null;
}): SignalsDeskKpiItem[] {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio,
    compositeDirection: input.compositeDirection
  });
  const alignmentLine = formatSignalsAlignmentDisplayLine(
    alignment,
    input.bias,
    input.maturationState
  );
  const layersHint = signalsAlignmentKpiSubline({
    bias: input.bias,
    alignment
  });

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
      headlineTone: alignmentHeadlineTone(input.bias, alignment.aligned)
    },
    {
      target: "execution",
      label: "Execution",
      headline: executionReadinessLabel(input.decision.state, {
        tradingMode: input.tradingMode,
        regularSessionOpen: input.regularSessionOpen
      }),
      subline: executionSubline(
        input.decision,
        input.tradingMode,
        input.bias,
        input.regularSessionOpen,
        input.setupJudgment
      ),
      headlineTone: executionDisplayTone(input.decision.state, {
        tradingMode: input.tradingMode,
        regularSessionOpen: input.regularSessionOpen
      })
    }
  ];
}
