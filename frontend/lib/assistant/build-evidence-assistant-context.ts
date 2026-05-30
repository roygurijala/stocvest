import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import { narrowGapIntelForAssistant } from "@/lib/assistant/gap-intel-context";
import type { AssistantLayerKey, AssistantLayerStatus, AssistantPageContext } from "@/lib/assistant/types";
import { deriveEvidenceInsightFallback, type SignalEvidenceData } from "@/lib/signal-evidence";
import { synthTradeDecision } from "@/lib/signal-evidence/trade-decision";

export interface BuildEvidenceAssistantContextInput {
  evidence: SignalEvidenceData;
  tradingMode: "swing" | "day";
  /** Page id published to the assistant whitelist (e.g. dashboard/scanner, signals/layers). */
  page: string;
  gapIntelSnapshot?: GapIntelSnapshot | null;
  analysisStatus?: AssistantPageContext["analysis_status"];
}

/**
 * Symbol-level Evidence card context for the STOCVEST Assistant.
 * Used when the user opens Signal Evidence from Scanner (or any surface that
 * does not already publish full Signals desk context).
 */
export function buildEvidenceAssistantContext(
  input: BuildEvidenceAssistantContextInput
): AssistantPageContext | null {
  const sym = (input.evidence.symbol ?? "").trim().toUpperCase();
  if (!sym) return null;

  const layerStatus: Partial<Record<AssistantLayerKey, AssistantLayerStatus>> = {};
  for (const layer of input.evidence.layers ?? []) {
    const k = layer.key as AssistantLayerKey;
    if (
      k === "technical" ||
      k === "news" ||
      k === "macro" ||
      k === "sector" ||
      k === "geopolitical" ||
      k === "internals"
    ) {
      layerStatus[k] = layer.status;
    }
  }

  const gapIntelForAssistant = narrowGapIntelForAssistant(input.gapIntelSnapshot);
  const layerStatusForCtx = Object.keys(layerStatus).length > 0 ? layerStatus : undefined;

  const hasRenderableLayers = (input.evidence.layers?.length ?? 0) > 0;
  const insight = input.evidence.insight ?? deriveEvidenceInsightFallback(input.evidence);
  if (!input.evidence.insight && !hasRenderableLayers) {
    return {
      page: input.page,
      trading_mode: input.tradingMode,
      symbol: sym,
      analysis_status: input.analysisStatus ?? "loading",
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }
  const decision = synthTradeDecision(input.evidence, insight, input.tradingMode);
  const reinforcements = (decision.reinforcements ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    page: input.page,
    trading_mode: input.tradingMode,
    symbol: sym,
    analysis_status: input.analysisStatus ?? "loaded",
    decision_state: decision.state,
    decision_line: decision.line,
    decision_rationale: decision.rationale ?? undefined,
    decision_reinforcements: reinforcements.length > 0 ? reinforcements : undefined,
    trade_readiness:
      typeof insight.signal_score === "number" && Number.isFinite(insight.signal_score)
        ? insight.signal_score
        : null,
    risk_reward:
      typeof insight.risk_reward === "number" && Number.isFinite(insight.risk_reward)
        ? insight.risk_reward
        : null,
    trend_strength: insight.trend_strength || undefined,
    trend_direction: insight.trend_direction || undefined,
    market_regime: insight.market_regime || undefined,
    layer_alignment_pct:
      insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
        ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * 100)
        : null,
    layer_status: layerStatusForCtx,
    conviction_tier: decision.conviction?.tier,
    conviction_label: decision.conviction?.label,
    conviction_summary: decision.conviction?.summaryLine,
    ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
  };
}
