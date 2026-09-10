import type {
  AssistantLayerDetail,
  AssistantLayerKey,
  AssistantLayerStatus,
  AssistantPageContext
} from "@/lib/assistant/types";
import { narrowGapIntelForAssistant } from "@/lib/assistant/gap-intel-context";
import { indicatorHighlights } from "@/lib/signals/layer-drawer-present";
import { enrichSignalsDeskAssistantContext } from "@/lib/assistant/signals-desk-assistant-context";
import {
  deriveEvidenceInsightFallback,
  parseSwingCompositeInsight,
  type SignalEvidenceData
} from "@/lib/signal-evidence";
import { parseMarketEnvironment } from "@/lib/signal-evidence/market-environment-present";
import { synthTradeDecision, type TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import type { SignalsLayerRowInput, SignalsSetupBias } from "@/lib/signals-page-present";

const ASSISTANT_LAYER_KEYS: readonly AssistantLayerKey[] = [
  "technical",
  "news",
  "macro",
  "sector",
  "geopolitical",
  "internals"
] as const;

function isAssistantLayerKey(key: string): key is AssistantLayerKey {
  return (ASSISTANT_LAYER_KEYS as readonly string[]).includes(key);
}

function isAssistantLayerStatus(status: string): status is AssistantLayerStatus {
  return (
    status === "Bullish" ||
    status === "Bearish" ||
    status === "Neutral" ||
    status === "Unavailable" ||
    status === "As of close"
  );
}

export function layerStatusFromSignalsRows(
  rows: SignalsLayerRowInput[]
): Partial<Record<AssistantLayerKey, AssistantLayerStatus>> | undefined {
  const layerStatus: Partial<Record<AssistantLayerKey, AssistantLayerStatus>> = {};
  for (const row of rows) {
    const key = row.key;
    if (!isAssistantLayerKey(key)) continue;
    const status = String(row.status ?? "");
    if (isAssistantLayerStatus(status)) {
      layerStatus[key] = status;
    }
  }
  return Object.keys(layerStatus).length > 0 ? layerStatus : undefined;
}

export function layerStatusFromEvidence(
  evidence: SignalEvidenceData | null | undefined
): Partial<Record<AssistantLayerKey, AssistantLayerStatus>> | undefined {
  if (!evidence?.layers?.length) return undefined;
  const layerStatus: Partial<Record<AssistantLayerKey, AssistantLayerStatus>> = {};
  for (const layer of evidence.layers) {
    const k = layer.key;
    if (!isAssistantLayerKey(k)) continue;
    const status = String(layer.status ?? "");
    if (isAssistantLayerStatus(status)) {
      layerStatus[k] = status;
    }
  }
  return Object.keys(layerStatus).length > 0 ? layerStatus : undefined;
}

function mergeLayerStatus(
  deskRows: SignalsLayerRowInput[],
  evidence: SignalEvidenceData | null | undefined
): Partial<Record<AssistantLayerKey, AssistantLayerStatus>> | undefined {
  return layerStatusFromSignalsRows(deskRows) ?? layerStatusFromEvidence(evidence);
}

/** Format one indicator snapshot entry for assistant narration (public market technicals only). */
function formatIndicatorHighlight(key: string, value: string | number | boolean | null): string {
  if (typeof value === "number") {
    const priceLike = /sma|ema|vwap/.test(key);
    return `${key}: ${priceLike ? `$${value.toFixed(2)}` : value}`;
  }
  return `${key}: ${String(value)}`;
}

/**
 * Per-layer glass-box detail (reasoning + chips + technical indicator values) so the assistant
 * can explain WHY each layer reads the way it does — not just the verdict. Deep-dive rows carry
 * the full payload; the Signals desk carries reasoning (as `explanation`). Bounded + faithful.
 */
export function layerDetailsFromSignalsRows(
  rows: SignalsLayerRowInput[]
): AssistantLayerDetail[] | undefined {
  const out: AssistantLayerDetail[] = [];
  for (const row of rows) {
    if (!isAssistantLayerKey(row.key)) continue;
    const reasoning = String(row.reasoning ?? row.explanation ?? "").trim();
    const chips = (row.chips ?? [])
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, 4);
    const indicators =
      row.key === "technical"
        ? indicatorHighlights(row.indicatorSnapshot)
            .slice(0, 4)
            .map(([k, v]) => formatIndicatorHighlight(k, v))
        : [];
    if (!reasoning && chips.length === 0 && indicators.length === 0) continue;
    const detail: AssistantLayerDetail = { key: row.key };
    if (reasoning) detail.reasoning = reasoning;
    if (chips.length) detail.chips = chips;
    if (indicators.length) detail.indicators = indicators;
    out.push(detail);
  }
  return out.length > 0 ? out : undefined;
}

function buildLoadedAssistantBase(input: {
  pageId: string;
  tradingMode: "day" | "swing" | "position";
  symbol: string;
  decision: TradeDecision;
  layerStatusForCtx?: Partial<Record<AssistantLayerKey, AssistantLayerStatus>>;
  layerDetailsForCtx?: AssistantLayerDetail[];
  gapIntelForAssistant?: ReturnType<typeof narrowGapIntelForAssistant>;
  tradeReadiness: number | null;
  riskReward: number | null;
  trendStrength?: string;
  trendDirection?: string;
  marketRegime?: string;
  causalNarrativeSummary?: string;
  causalBlockingChain?: string;
  timeframeAlignmentLabel?: string;
  layerAlignmentPct: number | null;
  environmentTier?: string;
  environmentHeadline?: string;
}): AssistantPageContext {
  return {
    page: input.pageId,
    trading_mode: input.tradingMode,
    symbol: input.symbol,
    analysis_status: "loaded",
    decision_state: input.decision.state,
    decision_line: input.decision.line,
    decision_rationale: input.decision.rationale ?? undefined,
    trade_readiness: input.tradeReadiness,
    risk_reward: input.riskReward,
    trend_strength: input.trendStrength,
    trend_direction: input.trendDirection,
    market_regime: input.marketRegime,
    causal_narrative_summary: input.causalNarrativeSummary,
    causal_blocking_chain: input.causalBlockingChain,
    timeframe_alignment_label: input.timeframeAlignmentLabel,
    layer_alignment_pct: input.layerAlignmentPct,
    environment_tier: input.environmentTier,
    environment_headline: input.environmentHeadline,
    layer_status: input.layerStatusForCtx,
    ...(input.layerDetailsForCtx ? { layer_details: input.layerDetailsForCtx } : {}),
    ...(input.gapIntelForAssistant ? { gap_intel: input.gapIntelForAssistant } : {})
  };
}

/** Swing/day KPI helpers — position desk reuses swing execution copy until POS-AI-3. */
function kpiTradingMode(mode: "day" | "swing" | "position"): "day" | "swing" {
  return mode === "day" ? "day" : "swing";
}

export type BuildSignalsPageAssistantContextInput = {
  /**
   * Page identifier emitted to the assistant. Defaults to the Signals desk
   * (`"signals/layers"`); the Trading Room deep dive passes its own id so the
   * assistant knows which surface is open while reusing the identical context depth.
   */
  pageId?: string;
  tradingMode: "day" | "swing" | "position";
  symbol: string;
  symbolCommitted: boolean;
  hasValidSignal: boolean;
  compositeLoading: boolean;
  isInsufficientComposite: boolean;
  pageDecision: TradeDecision | null;
  signalsPresentRows: SignalsLayerRowInput[];
  setupBias: SignalsSetupBias;
  compositeAlignmentRatio: number | null;
  layerAgreementPercent: number | null;
  setupJudgment: SetupJudgment | null;
  compositeResult: Record<string, unknown> | null;
    causalNarrativeSummary?: string | null;
  causalBlockingChain?: string | null;
  timeframeAlignmentLabel?: string | null;
  marketEnvironment?: import("@/lib/signal-evidence/market-environment-present").MarketEnvironmentPayload | null;
  maturationState?: string | null;
  maturationLabel?: string | null;
  regularSessionOpen?: boolean | null;
  gapIntelSnapshot: Parameters<typeof narrowGapIntelForAssistant>[0];
  signalEvidence: SignalEvidenceData | null;
};

/**
 * Page context for the Signals desk — mirrors what the user sees from composite
 * (`pageDecision`, layer rows) and falls back to Evidence modal data when needed.
 */
export function buildSignalsPageAssistantContext(
  input: BuildSignalsPageAssistantContextInput
): AssistantPageContext | null {
  const pageId = input.pageId ?? "signals/layers";
  const sym = input.symbol.trim().toUpperCase();
  if (!sym) {
    return { page: pageId, trading_mode: input.tradingMode };
  }

  const gapIntelForAssistant = narrowGapIntelForAssistant(input.gapIntelSnapshot);
  const layerStatusForCtx = mergeLayerStatus(input.signalsPresentRows, input.signalEvidence);
  const layerDetailsForCtx = layerDetailsFromSignalsRows(input.signalsPresentRows);

  const enrichInput = {
    setupBias: input.setupBias,
    rows: input.signalsPresentRows,
    alignmentRatio: input.compositeAlignmentRatio,
    maturationState: input.maturationState,
    maturationLabel: input.maturationLabel,
    tradingMode: kpiTradingMode(input.tradingMode),
    regularSessionOpen: input.regularSessionOpen,
    setupJudgment: input.setupJudgment
  };

  const deskEnvironment =
    input.marketEnvironment ??
    input.signalEvidence?.marketEnvironment ??
    (input.compositeResult ? parseMarketEnvironment(input.compositeResult) : null);

  if (input.hasValidSignal && input.pageDecision) {
    const compositeInsight = input.compositeResult
      ? parseSwingCompositeInsight(input.compositeResult)
      : null;
    const layerAlignmentPct =
      input.compositeAlignmentRatio != null && Number.isFinite(input.compositeAlignmentRatio)
        ? Math.round(Math.max(0, Math.min(1, input.compositeAlignmentRatio)) * 100)
        : input.layerAgreementPercent;
    const base = buildLoadedAssistantBase({
      pageId,
      tradingMode: input.tradingMode,
      symbol: sym,
      decision: input.pageDecision,
      layerStatusForCtx,
      layerDetailsForCtx,
      gapIntelForAssistant,
      tradeReadiness:
        input.setupJudgment?.engineScores?.quality ??
        compositeInsight?.signal_score ??
        null,
      riskReward:
        compositeInsight?.risk_reward ??
        (typeof input.compositeResult?.risk_reward === "number" &&
        Number.isFinite(input.compositeResult.risk_reward as number)
          ? (input.compositeResult.risk_reward as number)
          : null),
      trendStrength: compositeInsight?.trend_strength,
      trendDirection: compositeInsight?.trend_direction,
      marketRegime: compositeInsight?.market_regime,
      causalNarrativeSummary: input.causalNarrativeSummary ?? undefined,
      causalBlockingChain: input.causalBlockingChain ?? undefined,
      timeframeAlignmentLabel: input.timeframeAlignmentLabel ?? undefined,
      layerAlignmentPct,
      environmentTier: deskEnvironment?.environment_tier,
      environmentHeadline: deskEnvironment?.headline
    });
    return enrichSignalsDeskAssistantContext(base, {
      ...enrichInput,
      decision: input.pageDecision
    });
  }

  if (input.signalEvidence) {
    const insight =
      input.signalEvidence.insight ?? deriveEvidenceInsightFallback(input.signalEvidence);
    const decision = synthTradeDecision(input.signalEvidence, insight, kpiTradingMode(input.tradingMode));
    const layerAlignmentPct =
      insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
        ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * 100)
        : null;
    const base = buildLoadedAssistantBase({
      pageId,
      tradingMode: input.tradingMode,
      symbol: sym,
      decision,
      layerStatusForCtx: layerStatusForCtx ?? layerStatusFromEvidence(input.signalEvidence),
      layerDetailsForCtx,
      gapIntelForAssistant,
      tradeReadiness:
        input.setupJudgment?.engineScores?.quality ??
        (typeof insight.signal_score === "number" && Number.isFinite(insight.signal_score)
          ? insight.signal_score
          : null),
      riskReward:
        typeof insight.risk_reward === "number" && Number.isFinite(insight.risk_reward)
          ? insight.risk_reward
          : null,
      trendStrength: insight.trend_strength || undefined,
      trendDirection: insight.trend_direction || undefined,
      marketRegime: insight.market_regime || undefined,
      causalNarrativeSummary: input.causalNarrativeSummary ?? undefined,
      causalBlockingChain: input.causalBlockingChain ?? undefined,
      timeframeAlignmentLabel: input.timeframeAlignmentLabel ?? undefined,
      layerAlignmentPct,
      environmentTier: deskEnvironment?.environment_tier,
      environmentHeadline: deskEnvironment?.headline
    });
    return enrichSignalsDeskAssistantContext(base, {
      ...enrichInput,
      decision
    });
  }

  if (input.isInsufficientComposite) {
    return {
      page: pageId,
      trading_mode: input.tradingMode,
      symbol: sym,
      analysis_status: "insufficient_data",
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }

  if (input.symbolCommitted && input.compositeLoading) {
    return {
      page: pageId,
      trading_mode: input.tradingMode,
      symbol: sym,
      analysis_status: "loading",
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }

  if (input.symbolCommitted) {
    return {
      page: pageId,
      trading_mode: input.tradingMode,
      symbol: sym,
      analysis_status: "loading",
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }

  return {
    page: pageId,
    trading_mode: input.tradingMode,
    symbol: sym,
    layer_status: layerStatusForCtx,
    ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
  };
}
