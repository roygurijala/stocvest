"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { EvidenceCardHeader } from "@/components/signal-evidence/evidence-card-header";
import { EvidenceLayerContribution } from "@/components/signal-evidence/evidence-layer-contribution";
import { FundamentalBackdropPanel } from "@/components/signal-evidence/fundamental-backdrop";
import { LaggardInsight } from "@/components/signal/LaggardInsight";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import {
  evidenceDirectionToBias,
  evidenceLayerToRow,
  evidenceLayersToRows
} from "@/lib/signal-evidence/evidence-card-present";
import {
  evidenceLayerDisplayExplanation,
  evidenceLayerInsightText
} from "@/lib/signal-evidence/layer-plain-english";
import { CausalNarrativePanel } from "@/components/signals/causal-narrative-panel";
import { TimeframeContextPanel } from "@/components/signals/timeframe-context-panel";
import { resolveCausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import { resolveTimeframeContext } from "@/lib/signal-evidence/timeframe-context";
import { executionQualitySummaryLine } from "@/lib/signal-evidence/execution-quality";
import { PlanningGatesPanel } from "@/components/signal-evidence/planning-gates-panel";
import { RiskStackPanel } from "@/components/signal-evidence/risk-stack-panel";
import {
  buildCompressedContextSummary,
  buildNewsNeutralParenthetical,
  isLayerCompressible,
  layerEmphasisTier,
  shouldCompressContextLayers
} from "@/lib/signal-evidence/layer-emphasis";
import {
  computeSignalPriceDisplay,
  formatSignalPrice,
  formatSignalPriceDeltaPct
} from "@/lib/signal-evidence/signal-price-display";
import {
  catalystPublishedAgo,
  buildVerdictTagReconciler,
  conflictTierLabel,
  deriveEvidenceInsightFallback,
  filterChipsForMode,
  rankConflictingSignals,
  sanitizeEvidenceChips,
  VWAP_STATE,
  getVWAPDisplay,
  type SignalEvidenceData
} from "@/lib/signal-evidence";
import { pickNewsEmptyCopy } from "@/lib/news-empty-copy";
import { AI_VERDICT_TIP, LAYER_NAME_HINTS } from "@/lib/ui-tooltips";
import { AIExplanationDisplay } from "@/components/ai-explanation-display";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import {
  augmentScenarioInputWithGapIntel,
  buildScenarioInputFromEvidenceParts
} from "@/lib/scenario/scenario-input-present";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { useHasAIExplanations, useUserProfileLoaded } from "@/lib/api/user";
import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import type { ScenarioInput, ScenarioMode } from "@/lib/scenario/types";
import {
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import { buildScenarioPreviewPanelData } from "@/lib/scenario/scenario-preview-panels";
import { synthTradeDecision } from "@/lib/signal-evidence/trade-decision";
import { SetupJudgmentSummary } from "@/components/signals/setup-judgment-summary";
import { deriveSetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { resolveCompositeLayerAlignment } from "@/lib/signals-page-present";
import {
  executionDisplayTone,
  executionReadinessLabel,
  regularSessionOpenFromCompositePayload
} from "@/lib/signals-page-present";
import { buildEvidenceRiskHorizonFactors } from "@/lib/signal-evidence/fundamental-present";
import { EvidenceSetupEvolutionLink } from "@/components/signal-evidence/evidence-setup-evolution-link";

interface SignalEvidenceCardProps {
  evidence: SignalEvidenceData;
  onOpenNewsPanel?: (symbol: string) => void;
  /** Server Gap Intelligence snapshot for Scenario Builder gating + assistant context. */
  gapIntelSnapshot?: GapIntelSnapshot | null;
}

import {
  confluenceChips,
  displayLayerFreshness,
  displayUpdatedLabel,
  elevatedCardStyle,
  formatCatalystSource,
  formatLevel,
  GeopoliticalExposurePanel,
  GeoStructuralBaselinePanel,
  SectorMomentumPanel,
  sectorLayerHasMomentumDetails,
  signalPriceDriftColor,
  statusColor,
  technicalOrbChipPresentation,
  technicalVwapChipPresentation,
  tierVisualOverrides,
  toneFromStatus,
  truncateCatalystTitle
} from "./signal-evidence-card-helpers";

export function SignalEvidenceCard({ evidence, onOpenNewsPanel, gapIntelSnapshot }: SignalEvidenceCardProps) {
  const { colors } = useTheme();
  const hasAIExplanations = useHasAIExplanations();
  const profileLoaded = useUserProfileLoaded();
  const [captureEx, setCaptureEx] = useState<{
    text: string;
    source: "ai" | "deterministic";
    upgrade: boolean;
    cached: boolean;
  } | null>(null);
  const insight = evidence.insight ?? deriveEvidenceInsightFallback(evidence);

  useEffect(() => {
    let cancelled = false;
    const sym = evidence.symbol.trim().toUpperCase();
    const topLayers = evidence.layers.slice(0, 4).map((l) => ({
      layer: l.key,
      status: l.status,
      score: l.contributionScore
    }));
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/signals/ai/explanations", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "signal_capture",
            symbol: sym,
            score: insight.signal_score,
            verdict: evidence.direction,
            risk_reward: insight.risk_reward,
            top_layers: topLayers
          })
        });
        if (!res.ok) throw new Error("explanation request failed");
        const j = (await res.json()) as {
          text?: string;
          source?: string;
          upgrade_available?: boolean;
          cached?: boolean;
        };
        if (cancelled) return;
        setCaptureEx({
          text: String(j.text || ""),
          source: j.source === "ai" ? "ai" : "deterministic",
          upgrade: Boolean(j.upgrade_available),
          cached: Boolean(j.cached)
        });
      } catch {
        if (!cancelled) setCaptureEx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    evidence.symbol,
    evidence.direction,
    evidence.layers,
    insight.signal_score,
    insight.risk_reward,
    evidence.updatedAtIso
  ]);

  const captureDisplayText = (() => {
    // Defensive fallback chain (BRK-B Issue 5 fix, 2026-05-13). If the BFF
    // /api/stocvest/signals/ai/explanations call returns 5xx or an empty
    // text body we used to render an empty italic quote ("...") in the
    // "Layer synthesis (informational)" section. That looked like a broken render to
    // users. We now degrade through:
    //   1. AI-cached / AI-live text                  (captureEx.text)
    //   2. Deterministic short verdict copy          (evidence.aiVerdict)
    //   3. Last-resort symbol/direction sentence     (built here)
    // so the section always shows a sensible sentence even when the
    // upstream provider is down or the cache is cold.
    if (captureEx?.text && captureEx.text.trim().length > 0) {
      return captureEx.text;
    }
    if (evidence.aiVerdict && evidence.aiVerdict.trim().length > 0) {
      return evidence.aiVerdict;
    }
    const dir = evidence.direction;
    const sym = evidence.symbol;
    if (dir === "bullish") {
      return `${sym} setup leans bullish — layers mostly agree. Open Evidence for layer detail.`;
    }
    if (dir === "bearish") {
      return `${sym} setup leans bearish — layers mostly agree. Open Evidence for layer detail.`;
    }
    return `${sym} signal layers are mixed. Open Evidence for layer detail.`;
  })();
  const captureCachedFlag = Boolean(captureEx?.cached);
  const showUpgradeAfterCapture =
    Boolean(captureEx?.upgrade) || (profileLoaded && !hasAIExplanations && captureEx !== null);
  const { yes: confYes, no: confNo } = confluenceChips(evidence, insight);
  const showConfluencePanel = confYes.length > 0 || confNo.length > 0;
  const geopoliticalDragActive = evidence.layers.some(
    (l) =>
      l.key === "geopolitical" &&
      l.geo != null &&
      (l.geo.geoHasLiveEvents === true || (l.geo.activeEvents?.length ?? 0) > 0) &&
      l.geo.exposureBand !== "low"
  );
  const verdictReconcilerText = buildVerdictTagReconciler(
    evidence.direction,
    confYes,
    confNo,
    geopoliticalDragActive
  );
  const setupBias = evidenceDirectionToBias(evidence.direction);
  const layerRows = evidenceLayersToRows(evidence.layers);
  const compositeAlignment = resolveCompositeLayerAlignment({
    rows: layerRows,
    bias: setupBias,
    alignmentRatio: insight.alignment_ratio ?? null
  });
  const entryZone =
    insight.historical_entry_zone ??
    (typeof evidence.keyLevels.support === "number" && typeof evidence.keyLevels.resistance === "number"
      ? { low: evidence.keyLevels.support, high: evidence.keyLevels.resistance }
      : null);
  const rt1 = insight.reference_target_1 ?? evidence.keyLevels.resistance ?? null;
  const rt2 = insight.reference_target_2 ?? (typeof evidence.keyLevels.resistance === "number" ? evidence.keyLevels.resistance * 1.012 : null);
  const stopLvl = insight.reference_stop_level ?? evidence.keyLevels.support ?? null;
  const vwap = insight.vwap ?? evidence.keyLevels.vwap ?? null;
  const lastPrice =
    typeof evidence.lastTradePrice === "number" && Number.isFinite(evidence.lastTradePrice) && evidence.lastTradePrice > 0
      ? evidence.lastTradePrice
      : null;
  const vwapRow = getVWAPDisplay(
    vwap,
    insight.vwap_state ?? evidence.keyLevels.vwap_state,
    lastPrice,
    insight.vwap_display ?? evidence.keyLevels.vwap_display,
    insight.vwap_tooltip ?? evidence.keyLevels.vwap_tooltip
  );
  const levelsComplete = Boolean(entryZone && rt1 != null && stopLvl != null);
  const evidenceMode: ScenarioMode =
    evidence.compositeMode === "swing" || evidence.signal_basis === "daily_bars_rth" ? "swing" : "day";
  const evidenceRegularSessionOpen = regularSessionOpenFromCompositePayload(evidence.compositePayload ?? null);
  const evidenceDirection: ScenarioInput["direction"] =
    evidence.direction === "bullish" || evidence.direction === "bearish" ? evidence.direction : "neutral";
  const scenarioForBuild = augmentScenarioInputWithGapIntel(
    buildScenarioInputFromEvidenceParts({
      symbol: evidence.symbol,
      direction: evidenceDirection,
      mode: evidenceMode,
      generatedAt: evidence.updatedAtIso ?? null,
      entryLow: entryZone?.low ?? null,
      entryHigh: entryZone?.high ?? null,
      stop: stopLvl ?? null,
      target1: rt1 ?? null,
      target2: rt2 ?? null,
      currentPrice: lastPrice ?? null,
      prevClose: evidence.prevClose ?? null,
      marketRegime: insight.market_regime ?? null,
      riskReward:
        typeof insight.risk_reward === "number" && Number.isFinite(insight.risk_reward) ? insight.risk_reward : null,
      directionBadgeLabel: evidence.directionBadgeLabel ?? null,
      deskEnvironmentHeadline: evidence.marketEnvironment?.headline ?? null,
      environmentTier: evidence.marketEnvironment?.environment_tier ?? null
    }),
    gapIntelSnapshot
  );
  const evidenceDecision = synthTradeDecision(evidence, insight, evidenceMode);
  const evidenceSetupJudgment = useMemo(() => {
    if (evidence.setupJudgment) return evidence.setupJudgment;
    return deriveSetupJudgment({
      mode: evidenceMode,
      rows: layerRows,
      bias: setupBias,
      alignmentRatio: insight.alignment_ratio ?? null,
      technicalReasoning: evidence.layers.find((l) => l.key === "technical")?.keyPoints?.join(" ") ?? null,
      unlockWatchFor: evidence.unlockForecast?.[0]?.trigger_condition ?? null
    });
  }, [evidence.setupJudgment, evidenceMode, layerRows, setupBias, insight.alignment_ratio, evidence.layers, evidence.unlockForecast]);
  const evidenceCausalNarrative = useMemo(
    () =>
      evidence.causalNarrative ??
      resolveCausalNarrative({
        signalSummary: evidence.direction,
        rows: layerRows,
        executionNote: evidenceDecision.rationale?.text ?? null
      }),
    [evidence.causalNarrative, evidence.direction, layerRows, evidenceDecision.rationale?.text]
  );
  const evidenceTimeframeContext = useMemo(
    () => resolveTimeframeContext(evidence.compositePayload ?? null, evidenceMode),
    [evidence.compositePayload, evidenceMode]
  );
  const evidenceReadiness: ScenarioReadinessContext = {
    symbol: evidence.symbol,
    mode: evidenceMode,
    setupBias,
    layerRows,
    alignmentRatio: insight.alignment_ratio ?? null,
    layersAligned: compositeAlignment.aligned,
    layersTotal: compositeAlignment.total,
    decisionState: evidenceDecision.state,
    systemDecision: evidenceDecision,
    hasReferenceLevels: levelsComplete
  };

  const evidencePreviewPanels = useMemo(() => {
    const resolved = resolveScenarioBuilderCapability(evidenceReadiness, scenarioForBuild);
    return buildScenarioPreviewPanelData({
      symbol: evidence.symbol,
      mode: evidenceMode,
      setupBias,
      layerRows,
      alignmentRatio: insight.alignment_ratio ?? null,
      gapIntel: gapIntelSnapshot,
      gapGate: scenarioForBuild.gap_intel_gate,
      executionTier: resolved.executionTier,
      surface: "evidence"
    });
  }, [
    evidenceReadiness,
    scenarioForBuild,
    evidence.symbol,
    evidenceMode,
    setupBias,
    layerRows,
    gapIntelSnapshot,
    insight.alignment_ratio
  ]);

  const evidenceRiskFactorBullets = useMemo(() => {
    if (evidenceMode !== "swing") return [];
    const macroLayer = evidence.layers.find((l) => l.key === "macro");
    const macroWarnings = (macroLayer?.macro_warnings ?? []).slice(0, 2);
    return buildEvidenceRiskHorizonFactors({
      context: evidence.fundamentalContext,
      earningsDaysAway: evidence.earningsRisk?.daysUntil ?? null,
      earningsRisk: evidence.earningsRisk?.risk ?? null,
      omitEarnings: evidence.earningsRisk != null,
      macroWarnings
    });
  }, [evidenceMode, evidence.fundamentalContext, evidence.earningsRisk, evidence.layers]);

  const showRiskHorizon =
    evidenceMode === "swing" && (evidence.earningsRisk != null || evidenceRiskFactorBullets.length > 0);

  return (
    <article style={{ display: "grid", gap: spacing[4], position: "relative", paddingBottom: spacing[4] }}>
      {showRiskHorizon ? (
        <section
          data-testid="evidence-risk-horizon"
          style={{
            border:
              evidence.earningsRisk?.risk === "imminent"
                ? "1px solid rgba(239,68,68,0.55)"
                : `1px solid ${colors.border}`,
            background:
              evidence.earningsRisk?.risk === "imminent"
                ? "rgba(239,68,68,0.12)"
                : colors.surface,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[2]
          }}
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: colors.textMuted }}>
            Risk horizon
          </p>
          {evidence.earningsRisk ? (
            <>
              <p
                style={{
                  margin: 0,
                  fontWeight: 700,
                  color: evidence.earningsRisk.risk === "imminent" ? colors.bearish : colors.caution
                }}
              >
                {evidence.earningsRisk.chip ??
                  `⚠️ Earnings: ${evidence.symbol} reports in ${evidence.earningsRisk.daysUntil} day${
                    evidence.earningsRisk.daysUntil === 1 ? "" : "s"
                  }`}
                {evidence.earningsRisk.reportDate ? ` · ${evidence.earningsRisk.reportDate}` : ""}
                {evidence.earningsRisk.reportTime === "before_market"
                  ? " · before market"
                  : evidence.earningsRisk.reportTime === "after_market"
                    ? " · after market close"
                    : evidence.earningsRisk.reportTime === "during_market"
                      ? " · during market"
                      : ""}
              </p>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
                Calendar context only — not a composite layer. Event uncertainty is separate from the six-layer alignment.
              </p>
            </>
          ) : null}
          {evidenceRiskFactorBullets.length > 0 ? (
            <div>
              <p className="m-0 text-xs font-semibold" style={{ color: colors.textMuted }}>
                Risk factors
              </p>
              <ul
                className="m-0 mt-1 list-disc space-y-1 pl-5 text-sm leading-snug"
                style={{ color: colors.text }}
                data-testid="evidence-risk-factors"
              >
                {evidenceRiskFactorBullets.map((line) => (
                  <li key={line.slice(0, 72)}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <EvidenceCardHeader
        symbol={evidence.symbol}
        tradingMode={evidenceMode}
        bias={setupBias}
        rows={layerRows}
        alignmentRatio={insight.alignment_ratio ?? null}
        updatedLabel={displayUpdatedLabel(evidence)}
        symbolRowExtras={
          <ScenarioBuilderInline
            input={scenarioForBuild}
            readiness={evidenceReadiness}
            drillDown={{ surface: "evidence" }}
            previewPanels={evidencePreviewPanels}
            prominent
            testId="signal-evidence-scenario-cta"
          />
        }
      >
        {geopoliticalDragActive ? (
          <span
            data-testid="geopolitical-drag-badge"
            title="Elevated geopolitical headlines are weighing on the composite read for this symbol's sector."
            style={{
              borderRadius: borderRadius.full,
              padding: "4px 10px",
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.04em",
              background: "rgba(239,68,68,0.12)",
              color: colors.bearish,
              border: `1px solid rgba(239,68,68,0.45)`,
              width: "fit-content"
            }}
          >
            GEOPOLITICAL DRAG
          </span>
        ) : null}
        {evidence.compositeMode === "swing" || evidence.signal_basis === "daily_bars_rth" ? (
          <div className="text-xs text-muted-foreground tracking-wide">
            {evidence.signal_basis_label?.trim() || "Derived from daily bars (RTH)"}
          </div>
        ) : null}
        {(() => {
          const sp = computeSignalPriceDisplay(evidence.priceAtSignal, evidence.lastTradePrice);
          if (sp == null) return null;
          const deltaColor =
            sp.driftTier != null ? signalPriceDriftColor(sp.driftTier, colors) : colors.textMuted;
          return (
            <div
              data-testid="signal-evidence-price-drift"
              data-drift-tier={sp.driftTier ?? "unavailable"}
              aria-label={sp.accessibleLabel}
              style={{
                display: "inline-flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spacing[1],
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              <span style={{ fontWeight: 600, color: colors.textMuted }}>Signal price</span>
              {sp.priceAtSignal != null ? (
                <span data-testid="signal-evidence-price-drift-at-signal" style={{ color: colors.text }}>
                  {formatSignalPrice(sp.priceAtSignal)}
                </span>
              ) : (
                <span style={{ color: colors.textMuted, fontStyle: "italic" }}>computed-at price n/a</span>
              )}
              {sp.priceAtSignal != null && sp.currentPrice != null ? (
                <span aria-hidden="true" style={{ color: colors.textMuted }}>
                  →
                </span>
              ) : null}
              {sp.currentPrice != null ? (
                <span data-testid="signal-evidence-price-drift-current" style={{ color: colors.text }}>
                  {formatSignalPrice(sp.currentPrice)}
                </span>
              ) : (
                <span style={{ color: colors.textMuted, fontStyle: "italic" }}>current price n/a</span>
              )}
              {sp.deltaPct != null ? (
                <span
                  data-testid="signal-evidence-price-drift-delta"
                  style={{
                    marginLeft: spacing[1],
                    color: deltaColor,
                    fontWeight: 600
                  }}
                >
                  Δ {formatSignalPriceDeltaPct(sp.deltaPct)}
                </span>
              ) : null}
              <InfoTip
                text="Price the engine used when it computed this signal (left) versus the most recent price the card has on hand (right). Larger drift means the reference levels may describe a setup that has shifted; this is data, not advice."
                label="Signal price drift"
              />
            </div>
          );
        })()}
      </EvidenceCardHeader>

      <SetupJudgmentSummary
        judgment={evidenceSetupJudgment}
        executionLabel={executionReadinessLabel(evidenceDecision.state, {
          tradingMode: evidenceMode,
          regularSessionOpen: evidenceRegularSessionOpen,
          entryTimingWeak: evidenceSetupJudgment.tradeability.band === "weak"
        })}
        executionTone={executionDisplayTone(evidenceDecision.state, {
          tradingMode: evidenceMode,
          regularSessionOpen: evidenceRegularSessionOpen
        })}
      />

      {evidence.executionQuality ? (
        <p
          data-testid="signal-evidence-execution-quality"
          className="m-0 text-xs leading-snug"
          style={{ color: colors.textMuted, marginTop: spacing[2] }}
        >
          {executionQualitySummaryLine(evidence.executionQuality)}
        </p>
      ) : null}

      {evidence.marketEnvironment ? (
        <RiskStackPanel
          environment={evidence.marketEnvironment}
          signalState={evidence.apiDecisionState ?? evidenceDecision.state}
          insight={insight}
          planningGates={evidence.planningGates}
          ledgerGates={evidence.ledgerGateSummary}
        />
      ) : null}

      {evidence.planningGates ? <PlanningGatesPanel gates={evidence.planningGates} /> : null}

      {gapIntelSnapshot ? (
        <section
          data-testid="signal-evidence-gap-intel"
          style={{
            marginTop: spacing[3],
            marginBottom: spacing[2],
            padding: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceMuted
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>
              GAP INTELLIGENCE
            </span>
            <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.accent }}>
              {gapIntelSnapshot.phase.label}
            </span>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
              {gapIntelSnapshot.phase.window_start_et}–{gapIntelSnapshot.phase.window_end_et} ET
              {gapIntelSnapshot.phase.cadence_seconds > 0
                ? ` · ~${Math.max(1, Math.round(gapIntelSnapshot.phase.cadence_seconds / 60))} min cadence`
                : null}
            </span>
          </div>
          <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.text }}>
            Direction {gapIntelSnapshot.gap.direction}, structure {gapIntelSnapshot.gap.status}, resolution{" "}
            {gapIntelSnapshot.gap.resolution_state}
            {typeof gapIntelSnapshot.levels.fill_level === "number"
              ? `, fill reference ${gapIntelSnapshot.levels.fill_level.toFixed(2)} (${gapIntelSnapshot.levels.fill_source})`
              : ""}
            . Scenario builder state: {gapIntelSnapshot.scenario_builder.state}.
          </p>
          <p
            className="m-0 mt-1 text-xs leading-relaxed"
            style={{ color: colors.textMuted, fontStyle: "italic" }}
          >
          </p>
        </section>
      ) : null}

      <EvidenceLayerContribution layers={evidence.layers} bias={setupBias} />
      {evidenceTimeframeContext ? (
        <TimeframeContextPanel
          context={evidenceTimeframeContext}
          tradingMode={evidenceMode}
          setupBias={setupBias}
          compact
        />
      ) : null}
      {evidenceDecision.state !== "actionable" && evidenceCausalNarrative ? (
        <CausalNarrativePanel narrative={evidenceCausalNarrative} compact />
      ) : null}

      <FundamentalBackdropPanel
        context={evidence.fundamentalContext}
        isPaid={hasAIExplanations}
        mode={evidence.compositeMode}
      />

      <LaggardInsight signal={evidence.laggardSignal} isPaid={hasAIExplanations} mode={evidence.compositeMode} />

      <section>
        <h3 style={{ marginTop: 0 }}>Layer breakdown</h3>
        <div style={{ display: "grid", gap: spacing[3] }}>
          {/* B35 (BRK.B feedback, 2026-05-13): the layer-breakdown
              grid now applies an emphasis hierarchy and consolidates
              the three context layers (News + Macro + Geopolitical)
              into a single "Context" card when all three are Neutral
              with no active content. Layer-by-layer behaviour:

                - Technical always renders at `primary` tier — bigger
                  padding, full opacity. It is the load-bearing layer.
                - Sector + Geopolitical default to `tertiary` (compact,
                  muted) and promote to `secondary` the moment they
                  have active content.
                - News / Macro / Internals render at `secondary`.
                - Any layer that is Neutral + has nothing active to
                  surface collapses its body behind a `<details>`
                  disclosure — the header (icon + name + status) stays
                  visible so the user can see the layer is there.
                - The News-neutral chip carries a small italic
                  parenthetical reframing it as a soft headwind
                  ("no catalyst support → lowers continuation
                  probability"), which stays visible even when the
                  body is collapsed.

              Helpers live in `lib/signal-evidence/layer-emphasis.ts`
              and are pure / unit-tested in `tests/layer-emphasis.test.ts`. */}
          {(() => {
            const compressContext = shouldCompressContextLayers(evidence.layers);
            const contextSummary = compressContext
              ? buildCompressedContextSummary(evidence.layers)
              : null;
            const collapsedKeys = new Set(contextSummary?.collapsedLayerKeys ?? []);
            let contextCardRendered = false;
            const nodes: ReactNode[] = [];
            for (const layer of evidence.layers) {
              if (collapsedKeys.has(layer.key)) {
                if (contextCardRendered) continue;
                contextCardRendered = true;
                nodes.push(
                  <article
                    key="layer-compressed-context"
                    data-testid="layer-compressed-context"
                    data-collapsed-layer-keys={(contextSummary?.collapsedLayerKeys ?? []).join(",")}
                    style={{
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      display: "grid",
                      gap: spacing[2],
                      ...elevatedCardStyle(colors)
                    }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {contextSummary!.layers.map((inner) => (
                          <span key={`context-icon-${inner.key}`} aria-hidden="true">
                            {inner.icon}
                          </span>
                        ))}
                        <strong className="inline-flex items-center gap-1.5 text-sm sm:text-base">
                          {contextSummary!.title}
                          <InfoTip
                            text="News, Macro, and Geopolitical layers are all Neutral with no active content. Combined here to keep the breakdown focused on the load-bearing layers."
                            label="Context layer cluster"
                          />
                        </strong>
                      </div>
                      <span
                        className="w-fit text-sm"
                        style={{
                          borderRadius: borderRadius.full,
                          padding: "2px 8px",
                          background: "rgba(148,163,184,0.15)",
                          color: statusColor(contextSummary!.statusLabel, colors)
                        }}
                      >
                        {contextSummary!.statusLabel}
                      </span>
                    </div>
                    <p
                      className="text-sm leading-relaxed sm:text-base"
                      style={{ margin: 0, color: colors.textMuted }}
                      data-testid="layer-compressed-context-headline"
                    >
                      {contextSummary!.headline}
                    </p>
                    <details data-testid="layer-compressed-context-details">
                      <summary
                        style={{
                          cursor: "pointer",
                          color: colors.accent,
                          fontSize: typography.scale.xs,
                          listStyle: "none"
                        }}
                      >
                        Show News, Macro, and Geopolitical layer detail
                      </summary>
                      <div style={{ marginTop: spacing[2], display: "grid", gap: spacing[2] }}>
                        {contextSummary!.layers.map((inner) => (
                          <div
                            key={`context-inner-${inner.key}`}
                            data-testid={`layer-compressed-context-inner-${inner.key}`}
                            style={{
                              display: "grid",
                              gap: 4,
                              padding: spacing[2],
                              borderRadius: borderRadius.md,
                              border: `1px solid ${colors.border}`,
                              background: "rgba(148,163,184,0.04)"
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span aria-hidden="true">{inner.icon}</span>
                                <strong className="text-xs">{inner.name}</strong>
                              </div>
                              <span
                                style={{
                                  fontSize: typography.scale.xs,
                                  color: statusColor(inner.status, colors)
                                }}
                              >
                                {inner.status}
                              </span>
                            </div>
                            <p
                              style={{
                                margin: 0,
                                fontSize: typography.scale.xs,
                                color: colors.textMuted,
                                lineHeight: 1.45
                              }}
                            >
                              {evidenceLayerDisplayExplanation(inner)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </article>
                );
                continue;
              }

              const tier = layerEmphasisTier(layer);
              const compressible = isLayerCompressible(layer);
              const newsParen = buildNewsNeutralParenthetical(layer);
              const overrides = tierVisualOverrides(tier);
              const bodyFontSize =
                overrides.fontScale === "base"
                  ? typography.scale.base
                  : overrides.fontScale === "xs"
                    ? typography.scale.xs
                    : typography.scale.sm;

              const layerBody = (
                <>
                  <p
                    className="text-sm leading-relaxed sm:text-base"
                    style={{ margin: 0, color: colors.textMuted, fontSize: bodyFontSize }}
                  >
                    {evidenceLayerDisplayExplanation(layer)}
                  </p>
                  {layer.key === "macro" ? (
                <div className="flex flex-col gap-2">
                  {layer.macro_risk_level === "critical" && (layer.macro_warnings?.length ?? 0) > 0 ? (
                    <div className="mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                      <div className="text-sm font-medium text-red-400">⚠️ High-Impact Event Imminent</div>
                      {(layer.macro_warnings ?? []).map((w, i) => (
                        <div key={i} className="mt-0.5 text-xs text-red-300">
                          {w}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {layer.macro_risk_level === "elevated" && (layer.macro_warnings?.length ?? 0) > 0 ? (
                    <div className="mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <div className="text-sm font-medium text-amber-400">⚠️ Macro Event Today</div>
                      {(layer.macro_warnings ?? []).map((w, i) => (
                        <div key={i} className="mt-0.5 text-xs text-amber-300">
                          {w}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {layer.yield_curve ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Yield curve:</span>
                      <span
                        className={`text-xs font-medium ${
                          layer.yield_curve.regime === "normal"
                            ? "text-green-400"
                            : layer.yield_curve.regime === "flat"
                              ? "text-amber-400"
                              : "text-red-400"
                        }`}
                      >
                        {layer.yield_curve.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        (2yr {layer.yield_curve.yield_2yr.toFixed(2)}% / 10yr {layer.yield_curve.yield_10yr.toFixed(2)}%)
                      </span>
                    </div>
                  ) : null}
                  {(layer.upcoming_events?.length ?? 0) > 0 ? (
                    <div className="mt-1 space-y-1">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming</div>
                      {(layer.upcoming_events ?? []).slice(0, 3).map((ev) => (
                        <div key={ev.event_id} className="flex items-center justify-between text-xs">
                          <span
                            className={
                              ev.status === "imminent"
                                ? "font-medium text-red-400"
                                : ev.status === "today"
                                  ? "text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {ev.name}
                          </span>
                          <span className="text-muted-foreground">
                            {ev.status === "imminent"
                              ? `${Math.round(ev.hours_until * 60)}m`
                              : ev.status === "today"
                                ? "Today"
                                : `${Math.round(ev.hours_until / 24)}d`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(layer.key === "technical" && evidence.compositeMode === "swing"
                  ? filterChipsForMode(sanitizeEvidenceChips(layer.keyPoints), "swing")
                  : sanitizeEvidenceChips(layer.keyPoints)
                )
                  .filter((p) => !p.toLowerCase().includes("expired"))
                  .map((point, idx) => {
                    let pres =
                      layer.key === "technical"
                        ? technicalVwapChipPresentation(point, colors)
                        : { skip: true, chipStyle: {} as CSSProperties };
                    if (layer.key === "technical" && pres.skip) {
                      pres = technicalOrbChipPresentation(point, colors);
                    }
                    if (layer.key !== "technical") {
                      pres = {
                        skip: false,
                        chipStyle: {
                          fontSize: typography.scale.xs,
                          border: `1px solid ${colors.border}`,
                          color: colors.textMuted
                        } as CSSProperties
                      };
                    }
                    if (pres.skip) return null;
                    const Icon = layer.key === "technical" ? pres.Icon : undefined;
                    const merged: CSSProperties = {
                      borderRadius: borderRadius.full,
                      padding: "2px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      ...pres.chipStyle
                    };
                    return (
                      <span key={`${layer.key}-${idx}`} style={merged}>
                        {Icon ? <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
                        {point}
                      </span>
                    );
                  })}
              </div>
              {layer.key === "news" ? (
                <div style={{ display: "grid", gap: spacing[2] }}>
                  {layer.wim_summary ? (
                    <div className="mt-2 text-sm italic text-muted-foreground">
                      &ldquo;{layer.wim_summary}&rdquo;
                      <span className="ml-2 text-xs not-italic opacity-70">&mdash; Benzinga editorial</span>
                    </div>
                  ) : null}
                  {layer.latest_rating &&
                  ["upgrade", "downgrade", "initiates", "maintains"].some((k) =>
                    layer.latest_rating!.action.toLowerCase().includes(k)
                  ) ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${
                          layer.latest_rating.action.toLowerCase().includes("downgrade")
                            ? "rgba(239,68,68,0.5)"
                            : "rgba(34,197,94,0.5)"
                        }`,
                        background:
                          layer.latest_rating.action.toLowerCase().includes("downgrade") ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                        color: layer.latest_rating.action.toLowerCase().includes("downgrade") ? colors.bearish : colors.bullish
                      }}
                    >
                      {layer.latest_rating.firm}: {layer.latest_rating.action}
                      {layer.latest_rating.rating ? ` (${layer.latest_rating.rating})` : ""}
                      {typeof layer.latest_rating.upside_pct === "number" &&
                      Number.isFinite(layer.latest_rating.upside_pct)
                        ? ` · PT ${layer.latest_rating.upside_pct >= 0 ? "+" : ""}${layer.latest_rating.upside_pct.toFixed(1)}%`
                        : ""}
                    </span>
                  ) : null}
                  {layer.analyst_consensus?.label ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      data-testid="news-analyst-consensus-chip"
                      style={{
                        border: `1px solid ${
                          (layer.analyst_consensus.momentum ?? 0) < 0
                            ? "rgba(239,68,68,0.5)"
                            : "rgba(34,197,94,0.5)"
                        }`,
                        background:
                          (layer.analyst_consensus.momentum ?? 0) < 0
                            ? "rgba(239,68,68,0.1)"
                            : "rgba(34,197,94,0.1)",
                        color:
                          (layer.analyst_consensus.momentum ?? 0) < 0 ? colors.bearish : colors.bullish
                      }}
                    >
                      {layer.analyst_consensus.label}
                      {layer.analyst_consensus.upgrades_30d || layer.analyst_consensus.downgrades_30d
                        ? ` (${layer.analyst_consensus.upgrades_30d}↑ ${layer.analyst_consensus.downgrades_30d}↓${
                            layer.analyst_consensus.unique_firms ? " firms" : ""
                          })`
                        : ""}
                    </span>
                  ) : null}
                  {layer.earnings_result && layer.earnings_result.beat !== null ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${layer.earnings_result.beat ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
                        background: layer.earnings_result.beat ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: layer.earnings_result.beat ? colors.bullish : colors.bearish
                      }}
                    >
                      {layer.earnings_result.beat ? "Beat" : "Missed"} EPS{" "}
                      {typeof layer.earnings_result.eps_surprise_pct === "number" && Number.isFinite(layer.earnings_result.eps_surprise_pct)
                        ? `${layer.earnings_result.eps_surprise_pct > 0 ? "+" : ""}${layer.earnings_result.eps_surprise_pct.toFixed(1)}%`
                        : ""}
                    </span>
                  ) : null}
                  {layer.latest_guidance && (layer.latest_guidance.type === "raised" || layer.latest_guidance.type === "lowered") ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${layer.latest_guidance.type === "raised" ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
                        background: layer.latest_guidance.type === "raised" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: layer.latest_guidance.type === "raised" ? colors.bullish : colors.bearish
                      }}
                    >
                      {layer.latest_guidance.type === "raised" ? "Guidance raised" : "Guidance cut"}
                    </span>
                  ) : null}
                  {layer.analyst_feed_state === "unconfigured" &&
                  !layer.latest_rating &&
                  !layer.analyst_consensus?.label ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground"
                      data-testid="news-analyst-feed-unavailable"
                      style={{ border: "1px solid rgba(148,163,184,0.4)", background: "rgba(148,163,184,0.08)" }}
                    >
                      Analyst feed unavailable
                    </span>
                  ) : null}
                  {layer.news_data_state === "stale" && (layer.articles_count === 0 || layer.articles_count === undefined) ? (
                    <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>
                      {pickNewsEmptyCopy(evidence.symbol)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {layer.key === "news" && onOpenNewsPanel ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="border-0 bg-transparent p-0 text-xs font-semibold underline-offset-2 hover:underline"
                    style={{ color: colors.accent, cursor: "pointer" }}
                    onClick={() => onOpenNewsPanel(evidence.symbol)}
                  >
                    View all news for {evidence.symbol} →
                  </button>
                </div>
              ) : null}
              {layer.key === "sector" && sectorLayerHasMomentumDetails(layer) ? (
                <SectorMomentumPanel layer={layer} colors={colors} />
              ) : null}
              {layer.key === "geopolitical" && layer.geo ? (
                (layer.geo.activeEvents?.length ?? 0) > 0 || layer.geo.geoHasLiveEvents ? (
                  <GeopoliticalExposurePanel geo={layer.geo} colors={colors} />
                ) : (
                  <GeoStructuralBaselinePanel geo={layer.geo} colors={colors} />
                )
              ) : null}
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
                    {displayLayerFreshness(layer, evidence)}
                  </span>
                </>
              );

              nodes.push(
                <article
                  key={layer.key}
                  data-testid={`layer-card-${layer.key}`}
                  data-layer-tier={tier}
                  data-layer-compressible={compressible ? "true" : "false"}
                  style={{
                    borderRadius: borderRadius.lg,
                    padding: overrides.padding,
                    display: "grid",
                    gap: tier === "tertiary" ? 4 : spacing[2],
                    opacity: overrides.opacity,
                    ...elevatedCardStyle(colors, toneFromStatus(layer.status))
                  }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span aria-hidden="true">{layer.icon}</span>
                      <strong
                        className="inline-flex items-center gap-1.5"
                        style={{
                          fontSize: tier === "primary" ? typography.scale.base : typography.scale.sm,
                          fontWeight: overrides.headerWeight
                        }}
                      >
                        {layer.name}
                        <InfoTip
                          text={LAYER_NAME_HINTS[layer.key] || "Signal layer readout."}
                          label={layer.name}
                        />
                      </strong>
                    </div>
                    <span
                      className="w-fit text-sm"
                      style={{
                        borderRadius: borderRadius.full,
                        padding: "2px 8px",
                        background: "rgba(148,163,184,0.15)",
                        color: statusColor(layer.status, colors)
                      }}
                    >
                      {layer.status}
                    </span>
                  </div>
                  {(() => {
                    const causalBecause = evidenceCausalNarrative?.layerNotes[layer.key]?.because;
                    const displayExp = evidenceLayerDisplayExplanation(layer);
                    const layerInsight = evidenceLayerInsightText(layer, causalBecause);
                    if (layerInsight.trim() === displayExp.trim()) return null;
                    return (
                      <p
                        className="m-0 text-xs leading-snug"
                        style={{ color: colors.textMuted, fontStyle: "italic" }}
                        data-testid={`layer-${layer.key}-insight`}
                      >
                        {layerInsight}
                      </p>
                    );
                  })()}
                  {newsParen ? (
                    <span
                      data-testid={`layer-${layer.key}-neutral-parenthetical`}
                      style={{
                        fontSize: typography.scale.xs,
                        fontStyle: "italic",
                        color: colors.textMuted,
                        marginTop: -spacing[1]
                      }}
                    >
                      {newsParen}
                    </span>
                  ) : null}
                  {compressible ? (
                    <details data-testid={`layer-${layer.key}-collapsed`}>
                      <summary
                        style={{
                          cursor: "pointer",
                          color: colors.accent,
                          fontSize: typography.scale.xs,
                          listStyle: "none"
                        }}
                      >
                        Show evaluation detail
                      </summary>
                      <div style={{ marginTop: spacing[2], display: "grid", gap: spacing[2] }}>
                        {layerBody}
                      </div>
                    </details>
                  ) : (
                    layerBody
                  )}
                </article>
              );
            }
            return nodes;
          })()}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors)
            }}
          >
            <h3 style={{ margin: 0 }}>Reference Levels</h3>
            <p className="m-0 text-xs leading-snug text-muted-foreground" style={{ marginTop: spacing[1] }}>
              Reference levels (context, not entry signals)
            </p>
            {!levelsComplete ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
                Signal data incomplete - levels unavailable
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Historical Entry Zone: </strong>
              {entryZone ? `${formatLevel(entryZone.low)}–${formatLevel(entryZone.high)}` : "—"}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 1: </strong>
              {formatLevel(rt1)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 2: </strong>
              {formatLevel(rt2)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Stop Level: </strong>
              {formatLevel(stopLvl)}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: typography.scale.sm,
                color: colors.textMuted,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6
              }}
            >
              <strong style={{ color: colors.text }}>VWAP: </strong>
              <span
                className={vwapRow.muted ? "text-muted-foreground" : undefined}
                style={{
                  color:
                    vwapRow.state === VWAP_STATE.FORMING
                      ? colors.caution
                      : vwapRow.muted
                        ? colors.textMuted
                        : colors.text,
                  fontStyle: vwapRow.state === VWAP_STATE.PRE_MARKET && vwapRow.muted ? "italic" : undefined,
                  fontWeight: vwapRow.muted ? 500 : 600
                }}
              >
                {vwapRow.label}
              </span>
              <InfoTip text={vwapRow.tooltip} label="VWAP context" />
            </p>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
          </div>

          {showConfluencePanel ? (
            <div
              style={{
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                display: "grid",
                gap: spacing[2],
                ...elevatedCardStyle(colors)
              }}
            >
              <h3 style={{ margin: 0 }}>Confirming Signals</h3>
              {/* Conflicting chips get a priority sort (BRK.B feedback,
                  2026-05-13). When there are 2+ counterweights, the
                  first three are labelled PRIMARY / SECONDARY / TERTIARY
                  so the user knows at a glance which conflict matters
                  most — previously the rail showed e.g. "EMA conflict,
                  VWAP conflict, Weak volume" in arrival order with no
                  way to tell which was load-bearing for the setup.
                  Confirming chips deliberately keep their natural
                  order — they are co-equal anchors, not a ranked list. */}
              {(() => {
                const rankedConfNo = rankConflictingSignals(confNo);
                return (
                  <div className="flex flex-wrap gap-2" data-testid="confluence-chip-rail">
                    {confYes.map((c, i) => (
                      <span
                        key={`cf-yes-${i}-${c.label}`}
                        style={{
                          borderRadius: borderRadius.full,
                          padding: "4px 10px",
                          fontSize: typography.scale.xs,
                          fontWeight: 600,
                          border: `1px solid rgba(34,197,94,0.45)`,
                          background: "rgba(34,197,94,0.12)",
                          color: colors.bullish
                        }}
                      >
                        {c.label} ✓
                      </span>
                    ))}
                    {rankedConfNo.map((c, i) => {
                      const tier = conflictTierLabel(i, rankedConfNo.length);
                      return (
                        <span
                          key={`cf-no-${i}-${c.label}`}
                          data-testid={tier ? `conflict-chip-${tier.toLowerCase()}` : undefined}
                          data-conflict-tier={tier ?? undefined}
                          data-conflict-source={c.source ?? undefined}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            borderRadius: borderRadius.full,
                            padding: "4px 10px",
                            fontSize: typography.scale.xs,
                            fontWeight: 600,
                            border: `1px solid rgba(239,68,68,0.45)`,
                            background: "rgba(239,68,68,0.12)",
                            color: colors.bearish
                          }}
                        >
                          {tier ? (
                            <span
                              style={{
                                fontSize: 9,
                                letterSpacing: 0.6,
                                opacity: 0.85,
                                padding: "1px 5px",
                                borderRadius: borderRadius.sm,
                                background: "rgba(239,68,68,0.18)",
                                border: "1px solid rgba(239,68,68,0.35)"
                              }}
                            >
                              {tier}
                            </span>
                          ) : null}
                          <span>{c.label} ✗</span>
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
              {verdictReconcilerText ? (
                <p
                  data-testid="verdict-tag-reconciler"
                  style={{
                    margin: 0,
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    lineHeight: 1.45,
                    fontStyle: "italic"
                  }}
                >
                  {verdictReconcilerText}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors)
            }}
          >
            <h3 style={{ margin: 0 }}>Catalysts &amp; Context</h3>
            {insight.catalysts.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant catalysts detected</p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[3] }}>
                {insight.catalysts.slice(0, 3).map((c, i) => {
                  const sent = c.sentiment.toLowerCase();
                  const sentimentChip =
                    sent === "positive"
                      ? {
                          label: "Bullish",
                          fg: colors.bullish,
                          bg: "rgba(34,197,94,0.12)",
                          border: "1px solid rgba(34,197,94,0.45)"
                        }
                      : sent === "negative"
                        ? {
                            label: "Bearish",
                            fg: colors.bearish,
                            bg: "rgba(239,68,68,0.12)",
                            border: "1px solid rgba(239,68,68,0.45)"
                          }
                        : {
                            label: "Neutral",
                            fg: colors.caution,
                            bg: "rgba(245,158,11,0.1)",
                            border: "1px solid rgba(245,158,11,0.35)"
                          };
                  const openNews = () => onOpenNewsPanel?.(evidence.symbol);
                  return (
                    <li key={`cat-${i}`} style={{ display: "grid", gap: spacing[1] }}>
                      <button
                        type="button"
                        className="text-left"
                        disabled={!onOpenNewsPanel}
                        onClick={openNews}
                        style={{
                          border: "none",
                          background: onOpenNewsPanel ? "rgba(59,130,246,0.08)" : "transparent",
                          borderRadius: borderRadius.md,
                          padding: spacing[2],
                          margin: 0,
                          cursor: onOpenNewsPanel ? "pointer" : "default",
                          display: "grid",
                          gap: spacing[1],
                          width: "100%"
                        }}
                        aria-label={onOpenNewsPanel ? `Open news drawer for ${evidence.symbol}` : undefined}
                      >
                      <span className="text-sm leading-snug" style={{ color: colors.text, fontWeight: 600 }}>
                        {truncateCatalystTitle(c.text)}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            fontWeight: 600,
                            border: `1px solid ${colors.border}`,
                            background: "rgba(148,163,184,0.12)",
                            color: colors.textMuted
                          }}
                        >
                          {formatCatalystSource(c.source)}
                        </span>
                        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{catalystPublishedAgo(c.published_at)}</span>
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            fontWeight: 700,
                            border: sentimentChip.border,
                            background: sentimentChip.bg,
                            color: sentimentChip.fg
                          }}
                        >
                          {sentimentChip.label}
                        </span>
                      </div>
                      {onOpenNewsPanel ? (
                        <span style={{ fontSize: 10, fontWeight: 600, color: colors.accent }}>Tap to open news →</span>
                      ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors)
            }}
          >
            <h3 style={{ margin: 0 }}>Risk Factors</h3>
            {insight.risk_factors.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant risk factors detected</p>
            ) : (
            <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
              {insight.risk_factors.slice(0, 6).map((r, i) => (
                <li key={`risk-${i}`} className="flex gap-2 text-sm" style={{ color: colors.text }}>
                  <span
                    style={{
                      marginTop: 6,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: colors.bearish,
                      flexShrink: 0
                    }}
                  />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          display: "grid",
          gap: spacing[2],
          ...elevatedCardStyle(colors)
        }}
      >
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: spacing[2] }}>
          <Brain size={18} />
          Layer synthesis (informational)
          <InfoTip text={AI_VERDICT_TIP} label="About AI signal analysis" />
        </h3>
        <AIExplanationDisplay
          text={captureDisplayText}
          source={captureEx ? captureEx.source : "deterministic"}
          cached={captureCachedFlag}
          colors={colors}
        />
        {/* Removed the dangling "Signal summary" caption (BRK-B Issue 5
            fix, 2026-05-13). It was a label with no value bound to it and
            users were reading it as a "Signal summary: (blank)" defect.
            The h3 above already explains what this section is. */}
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.aiFreshnessLabel}</span>
        {showUpgradeAfterCapture ? (
          <UpgradePrompt
            feature="AI Signal Explanations"
            plan="Swing Pro"
            description="Get plain-English explanations tailored to this specific setup and market context."
          />
        ) : null}
      </section>

      <details
        style={{
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          ...elevatedCardStyle(colors)
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontWeight: 600,
            color: colors.text,
            fontSize: typography.scale.sm
          }}
        >
          Signal parameters (reference context)
        </summary>
        <p
          style={{
            margin: `${spacing[2]} 0 0 0`,
            borderLeft: "2px solid rgba(0,180,255,0.3)",
            paddingLeft: 16,
            fontSize: 13,
            lineHeight: 1.8,
            color: colors.text
          }}
        >
          {insight.signal_parameters}
        </p>
      </details>

      <EvidenceSetupEvolutionLink symbol={evidence.symbol} mode={evidenceMode} />

      <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
        <SignalDisclaimerChip />
      </footer>
    </article>
  );
}
