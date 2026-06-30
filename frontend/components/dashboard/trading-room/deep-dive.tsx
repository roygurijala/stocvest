"use client";

/**
 * Trading Room — Active Setup Deep Dive.
 *
 * Fetches the composite payload on select (`useSignalComposite`) and renders the
 * decision in the trading-room's own visual language: a verdict header, a
 * decisive plain-English brief, and Setup / Layers / Evolution segmented tabs.
 *
 * It deliberately reuses the PURE composite libs (`parseSwingCompositeInsight`,
 * `compositeToSignalsLayerRows`) and the self-contained `SetupEvolutionPanel`
 * rather than the Signals-page desk components, which carry their own styling
 * that would clash with this surface. Scenario geometry (price ladder), the
 * reward-to-risk meter, reference levels, and risk factors all derive from the
 * one composite fetch so the deep dive never contradicts the signal card.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import { isUsRegularSessionOpenEt, nextRegularSessionOpenLabel } from "@/lib/market-hours-et";
import type { useTheme } from "@/lib/theme-provider";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import { revalidateSignalCompositeCache } from "@/lib/signal-composite-cache";
import { parseSwingCompositeInsight, parseCompositeAlignment, parseFundamentalContext } from "@/lib/signal-evidence";
import {
  compositeToSignalsLayerRows,
  deriveSetupBiasFromComposite
} from "@/lib/signals/composite-layer-rows";
import {
  buildSignalsPageDecision,
  parseCompositeDirectionFields,
  pickPreviewLayers,
  resolveCompositeLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import {
  buildBriefMetaLine,
  buildEntryZoneRrWarning,
  buildPlainSummary,
  buildRichBrief,
  resolveDeepDiveDirection,
  resolveDeepDiveVerdictLabel,
  resolveDeepDiveVerdictTone,
  resolveEntryZonePosition,
  scenarioFarthestTargetPrice,
  scenarioGeometryIsShort,
  scenarioGeometryTrackBounds,
  scenarioPriceAxisPercent
} from "@/lib/dashboard/trading-room/deep-dive-present";
import { buildScenarioRrFixGuidance } from "@/lib/scenario/scenario-rr-fix-guidance";
import { ScenarioRrFixPanel } from "@/components/dashboard/trading-room/scenario-rr-fix-panel";
import { isNonRenderableCompositeResponse } from "@/lib/api/swing-composite";
import type { SnapshotPayload } from "@/lib/api/market";
import { resolveSnapshotDisplayPrice } from "@/lib/api/snapshot-price";
import { resolveDeepDiveUnavailableMessage } from "@/lib/dashboard/trading-room/composite-unavailable-present";
import { resolveCausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import { resolveTimeframeContext, isTimeframeCounterTrend } from "@/lib/signal-evidence/timeframe-context";
import { resolveSetupJudgmentFromComposite } from "@/lib/signal-evidence/setup-judgment";
import { coerceSnapshotForReferenceLevels, deriveSessionReferenceLevels } from "@/lib/snapshot-reference-levels";
import { buildFundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
// Reuse the exact same signals-page components so Setup/Layers are identical.
import { SignalsBiasRationalePanel } from "@/components/signals/signals-bias-rationale-panel";
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import { AiSetupRead } from "@/components/signals/ai-setup-read";
import { SignalsLayerBreakdown } from "@/components/signals/signals-layer-breakdown";
import { CausalNarrativePanel } from "@/components/signals/causal-narrative-panel";
import { MarketContextPanel } from "@/components/signals/market-context-panel";
import { TimeframeContextPanel } from "@/components/signals/timeframe-context-panel";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { SetupEvolutionPanel } from "@/components/signals/setup-evolution-panel";
import { FullPriceChart, type ChartSignalOverlay } from "@/components/assistant/full-price-chart";
import { ContentLoading } from "@/components/content-loading";
import { ScenarioWhatIf } from "@/components/dashboard/trading-room/scenario-what-if";
import { RiskStackPanel } from "@/components/signal-evidence/risk-stack-panel";
import { isExecutionStageEligibleForScenarioAdjust } from "@/lib/scenario/scenario-variants";
import type { FeedBias, FeedCard, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import { parseLedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import { minRrForDeskMode, parseMarketEnvironment } from "@/lib/signal-evidence/market-environment-present";
import { structureRiskRewardLong, structureRiskRewardShort } from "@/lib/risk-reward-structure";
import { parseTarget2Provenance, target2ProvenanceLabel } from "@/lib/target-provenance";
import {
  buildEntryDistanceWarning,
  entryQualityTierLabel,
  entryStyleLabel,
  formatIdealPullbackZone,
  parseEntryDistanceTier,
  parseEntryQualityTier,
  parseEntryStyle
} from "@/lib/entry-zone";
import {
  parseMarketContextDampening,
  parseMarketContextFlags
} from "@/lib/signal-evidence/market-context-present";
import { parseApiDecisionState } from "@/lib/signal-evidence/risk-stack-present";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { buildSignalsPageAssistantContext } from "@/lib/assistant/build-signals-assistant-context";
import type { AssistantPageContext } from "@/lib/assistant/types";
import { parsePositiveRiskReward, resolveCompositeRiskRewardForDecision } from "@/lib/structure-risk-reward-present";
import { feedCardAllowsScenarioGeometry } from "@/lib/dashboard/trading-room/feed-setup-tier";
import { feedCardStateLabel } from "@/lib/dashboard/trading-room/feed-state-present";
import { SessionMoverContext } from "@/components/dashboard/trading-room/session-mover-context";
import { useSymbolName } from "@/lib/hooks/use-symbol-names";
import { useTrackedPlan } from "@/lib/hooks/use-tracked-plan";
import { buildTrackedPlanFromDeepDive } from "@/lib/trade-plan/build-tracked-plan";
import { buildDataQualityFlags } from "@/lib/trade-plan/data-quality-present";
import {
  buildLiveAssessmentFromDeepDive,
  resolveLiveVsPlanDiff,
  resolveTriggerDisplay
} from "@/lib/trade-plan/plan-status";
import {
  notifyTrackedPlanUpdated,
  removeTrackedPlanForSymbol,
  saveTrackedPlan
} from "@/lib/trade-plan/tracked-plan-store";
import { pushTrackedPlanRemovalToServer, pushTrackedPlanToServer } from "@/lib/trade-plan/tracked-plan-sync";
import { TrackPlanPanel } from "@/components/trade-plan/track-plan-panel";

type Colors = ReturnType<typeof useTheme>["colors"];
type DeepDiveTab = "setup" | "layers" | "evolution" | "charts";

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function positivePrice(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function biasPillStyle(bias: FeedBias, colors: Colors): CSSProperties {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return {
    display: "inline-block",
    fontSize: typography.scale.xs,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tone,
    background: `${tone}1f`,
    padding: "2px 8px",
    borderRadius: borderRadius.full
  };
}

function stateTone(state: FeedState, colors: Colors): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}


/**
 * Scenario geometry on a low→high price axis. Long: stop left / target right.
 * Short: target left (profit down) / stop right (loss up).
 */
function ScenarioGeometry({
  currentPrice,
  stopPrice,
  targetPrice,
  target1,
  target2,
  chosenLabel,
  entryLow,
  entryHigh,
  isShort,
  colors
}: {
  currentPrice: number;
  stopPrice: number;
  targetPrice: number;
  target1?: number | null;
  target2?: number | null;
  chosenLabel: "T1" | "T2";
  entryLow: number;
  entryHigh: number;
  isShort: boolean;
  colors: Colors;
}) {
  const short = scenarioGeometryIsShort(stopPrice, targetPrice, isShort);
  const farthestTarget = scenarioFarthestTargetPrice({
    isShort: short,
    target1,
    target2,
    fallbackTarget: targetPrice
  });
  const { trackMin, trackMax } = scenarioGeometryTrackBounds({
    stopPrice,
    target1,
    target2,
    entryLow,
    entryHigh,
    currentPrice
  });
  const pct = (p: number) => scenarioPriceAxisPercent(p, trackMin, trackMax);
  const entryLowPct = pct(entryLow);
  const entryHighPct = pct(entryHigh);
  const currentPct = pct(currentPrice);
  const t1Val = target1 != null && Number.isFinite(target1) ? (target1 as number) : null;
  const t2Val = target2 != null && Number.isFinite(target2) ? (target2 as number) : null;
  const t1Distinct = t1Val != null && Math.abs(t1Val - farthestTarget) > 0.01;
  const t2Distinct =
    t2Val != null && (t1Val == null || Math.abs(t2Val - t1Val) > 0.01);
  const showT1Marker = t1Val != null && (t1Distinct || t2Val == null);
  const showT2Marker = t2Distinct && t2Val != null;
  const t1Pct = showT1Marker ? pct(t1Val as number) : null;
  const t2Pct = showT2Marker ? pct(t2Val as number) : null;
  const currentLabelPct = Math.min(92, Math.max(8, currentPct));
  const inZone = currentPrice >= entryLow && currentPrice <= entryHigh;
  const leftLabel = short ? "Target" : "Stop";
  const rightLabel = short ? "Stop" : "Target";
  const leftPrice = short ? farthestTarget : stopPrice;
  const rightPrice = short ? stopPrice : farthestTarget;
  const leftColor = short ? colors.bullish : colors.bearish;
  const rightColor = short ? colors.bearish : colors.bullish;
  const trackGradient = short
    ? "linear-gradient(90deg, rgba(34,197,94,.45) 0%, rgba(148,163,184,.22) 50%, rgba(239,68,68,.45) 100%)"
    : "linear-gradient(90deg, rgba(239,68,68,.45) 0%, rgba(148,163,184,.22) 50%, rgba(34,197,94,.45) 100%)";

  const ENTRY_BLUE = "rgba(46,139,255,1)";

  const legendItem = (swatch: ReactNode, label: string, value: string, valueColor: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      {swatch}
      <span style={{ color: colors.textMuted, fontWeight: 600 }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          position: "relative",
          height: 10,
          marginTop: 20,
          borderRadius: 999,
          background: trackGradient
        }}
      >
        {/* Entry-zone band */}
        <div
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: `${entryLowPct}%`,
            width: `${Math.max(2, entryHighPct - entryLowPct)}%`,
            background: "rgba(46,139,255,.45)",
            border: "1px solid rgba(46,139,255,.85)",
            borderRadius: 999
          }}
        />
        {/* Current-price marker */}
        <div
          style={{
            position: "absolute",
            left: `${currentPct}%`,
            top: -5,
            transform: "translateX(-50%)",
            width: 3,
            height: 20,
            background: colors.text,
            borderRadius: 2,
            boxShadow: `0 0 0 2px ${colors.surface}`
          }}
        />
        {t1Pct != null ? (
          <div
            style={{
              position: "absolute",
              left: `${t1Pct}%`,
              top: -3,
              bottom: -3,
              transform: "translateX(-50%)",
              width: chosenLabel === "T1" ? 3 : 2,
              background: colors.bullish,
              opacity: chosenLabel === "T1" ? 1 : 0.65,
              borderRadius: 2
            }}
            title={`T1 $${(t1Val as number).toFixed(2)}${chosenLabel === "T1" ? " · planned" : ""}`}
          />
        ) : null}
        {t2Pct != null ? (
          <div
            style={{
              position: "absolute",
              left: `${t2Pct}%`,
              top: -3,
              bottom: -3,
              transform: "translateX(-50%)",
              width: chosenLabel === "T2" ? 3 : 2,
              background: colors.bullish,
              opacity: chosenLabel === "T2" ? 1 : 0.65,
              borderRadius: 2
            }}
            title={`T2 $${(t2Val as number).toFixed(2)}${chosenLabel === "T2" ? " · planned" : ""}`}
          />
        ) : null}
        {/* Floating current value tied to the marker */}
        <span
          style={{
            position: "absolute",
            left: `${currentLabelPct}%`,
            top: -20,
            transform: "translateX(-50%)",
            fontSize: 11,
            fontWeight: 700,
            color: colors.text,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap"
          }}
        >
          ${currentPrice.toFixed(2)}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.textMuted }}>
            {leftLabel}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: leftColor }}>
            ${leftPrice.toFixed(2)}
          </span>
          <span style={{ fontSize: 9.5, color: colors.textMuted }}>
            {short ? "profit if price falls" : "loss if price falls"}
          </span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: "right" }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.textMuted }}>
            {rightLabel}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: rightColor }}>
            ${rightPrice.toFixed(2)}
          </span>
          <span style={{ fontSize: 9.5, color: colors.textMuted }}>
            {short ? "loss if price rises" : "profit if price rises"}
          </span>
        </span>
      </div>

      {/* Color-keyed legend for the interior markers */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 10 }}>
        {legendItem(
          <span style={{ width: 14, height: 9, borderRadius: 3, background: "rgba(46,139,255,.45)", border: `1px solid ${ENTRY_BLUE}` }} />,
          "Entry zone",
          `$${entryLow.toFixed(2)}–$${entryHigh.toFixed(2)}`,
          ENTRY_BLUE
        )}
        {legendItem(
          <span style={{ width: 3, height: 12, borderRadius: 2, background: colors.text }} />,
          "Current",
          `$${currentPrice.toFixed(2)}${inZone ? " · in zone" : ""}`,
          colors.text
        )}
        {target1 != null
          ? legendItem(
              <span style={{ width: 3, height: 12, borderRadius: 2, background: colors.bullish, opacity: chosenLabel === "T1" ? 1 : 0.7 }} />,
              chosenLabel === "T1" ? "T1 · planned" : "T1",
              `$${(target1 as number).toFixed(2)}`,
              chosenLabel === "T1" ? colors.bullish : colors.textMuted
            )
          : null}
        {t2Distinct && target2 != null
          ? legendItem(
              <span style={{ width: 3, height: 12, borderRadius: 2, background: colors.bullish, opacity: chosenLabel === "T2" ? 1 : 0.7 }} />,
              chosenLabel === "T2" ? "T2 · planned" : "T2",
              `$${(target2 as number).toFixed(2)}`,
              chosenLabel === "T2" ? colors.bullish : colors.textMuted
            )
          : null}
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.textMuted }}>
        {short ? (
          <>
            Low price (left) → high price (right):{" "}
            <span style={{ color: colors.bullish, fontWeight: 700 }}>green</span> is profit toward target (down),{" "}
            <span style={{ color: colors.bearish, fontWeight: 700 }}>red</span> is loss toward stop (up).
          </>
        ) : (
          <>
            Low price (left) → high price (right):{" "}
            <span style={{ color: colors.bearish, fontWeight: 700 }}>red</span> is loss toward stop (down),{" "}
            <span style={{ color: colors.bullish, fontWeight: 700 }}>green</span> is profit toward target (up).
          </>
        )}
      </p>
    </div>
  );
}

/** Feed-state dot on each lane tab (actionable / near / cooling / potential). */
function LaneStateDot({ state, colors }: { state: FeedState | null; colors: Colors }) {
  if (!state) return null;
  const tone =
    state === "actionable"
      ? colors.bullish
      : state === "near"
        ? colors.caution
        : state === "cooling"
          ? colors.bearish
          : colors.textMuted;
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: tone,
        flexShrink: 0,
        boxShadow: state === "actionable" ? `0 0 8px ${tone}99` : undefined
      }}
    />
  );
}

/**
 * Day / Swing segmented control — desk-colored pills with a clear active state.
 * State dots reflect each lane's feed card when one exists.
 */
function LaneToggle({
  activeLane,
  onChange,
  dayState,
  swingState,
  symbol,
  colors
}: {
  activeLane: "day" | "swing";
  onChange: (lane: "day" | "swing") => void;
  /** null = no signal card in current feed for this lane. */
  dayState: FeedState | null;
  swingState: FeedState | null;
  symbol: string;
  colors: Colors;
}) {
  const dayAccent = roleAccents.dark.day;
  const swingAccent = roleAccents.dark.swing;

  const btn = (
    lane: "day" | "swing",
    label: string,
    laneState: FeedState | null,
    accent: (typeof roleAccents)["dark"]["day"]
  ) => {
    const active = activeLane === lane;
    const available = laneState !== null;
    const rail = accent.borderAccent;
    const text = accent.accentStrong;
    const tooltip = !available ? `No ${lane} setup for ${symbol} in today's feed` : undefined;

    return (
      <button
        key={lane}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(lane)}
        title={tooltip}
        style={{
          border: "none",
          background: active ? `${rail}30` : "transparent",
          boxShadow: active ? `inset 0 0 0 1.5px ${rail}, 0 0 14px ${rail}40` : "none",
          color: active ? text : colors.textMuted,
          fontSize: typography.scale.sm,
          fontWeight: 700,
          padding: "7px 16px",
          borderRadius: borderRadius.full,
          cursor: "pointer",
          letterSpacing: "0.03em",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          opacity: available || active ? 1 : 0.55,
          transition: "background .14s, color .14s, box-shadow .14s, opacity .14s",
          whiteSpace: "nowrap"
        }}
      >
        <LaneStateDot state={laneState} colors={colors} />
        {label}
      </button>
    );
  };

  return (
    <div
      role="tablist"
      aria-label={`${symbol} desk mode`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full,
        background: colors.background,
        flexShrink: 0
      }}
    >
      {btn("day", "Day", dayState, dayAccent)}
      {btn("swing", "Swing", swingState, swingAccent)}
    </div>
  );
}


function SegTabs({
  value,
  onSelect,
  chartsDot,
  colors
}: {
  value: DeepDiveTab;
  onSelect: (v: DeepDiveTab) => void;
  /** Optional status dot on the Charts tab: "entry" (green) | "caution" (amber). */
  chartsDot?: "entry" | "caution" | null;
  colors: Colors;
}) {
  const opts: { id: DeepDiveTab; label: string }[] = [
    { id: "setup", label: "Setup" },
    { id: "layers", label: "Layers" },
    { id: "evolution", label: "Evolution" },
    { id: "charts", label: "Charts" }
  ];
  return (
    <div
      role="tablist"
      className="deep-dive-seg-tabs"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 4,
        padding: 4,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.sm
      }}
    >
      {opts.map((opt) => {
        const active = opt.id === value;
        const dot = opt.id === "charts" ? chartsDot : null;
        const dotColor = dot === "entry" ? colors.bullish : dot === "caution" ? colors.caution : null;
        const dotTitle =
          dot === "entry"
            ? "Price is inside the entry zone"
            : dot === "caution"
              ? "Price is near the stop / setup is approaching"
              : undefined;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(opt.id)}
            title={dotTitle}
            style={{
              minHeight: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              border: active ? `1px solid ${colors.accent}` : "1px solid transparent",
              background: active ? "rgba(46,139,255,.16)" : "transparent",
              color: active ? "#cfe2ff" : colors.textMuted,
              fontSize: typography.scale.sm,
              fontWeight: active ? 700 : 600,
              padding: `0 ${spacing[2]}`,
              borderRadius: 7,
              cursor: "pointer",
              boxShadow: active ? "inset 0 0 0 1px rgba(46,139,255,.35)" : "none",
              transition: "background .12s, color .12s, border-color .12s"
            }}
          >
            {opt.label}
            {dotColor ? (
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: dotColor,
                  display: "inline-block",
                  boxShadow: `0 0 4px ${dotColor}`
                }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({ children, colors }: { children: string; colors: Colors }) {
  return (
    <span
      style={{
        fontSize: typography.scale.xs,
        color: colors.textMuted,
        letterSpacing: "0.1em",
        textTransform: "uppercase"
      }}
    >
      {children}
    </span>
  );
}

/** Semi-circle SVG gauge matching the prototype Risk/Reward panel. */
function RiskRewardGauge({
  rr,
  minRr,
  riskAmount,
  rewardAmount,
  colors
}: {
  rr: number;
  /** VIX-tier desk minimum (swing 3.0 elevated, etc.). */
  minRr: number;
  riskAmount?: number | null;
  rewardAmount?: number | null;
  colors: Colors;
}) {
  const MAX_RR = 6;
  const gate = Number.isFinite(minRr) && minRr > 0 ? minRr : 2;
  const capped = Math.min(Math.max(rr, 0), MAX_RR);
  const totalArc = 157; // π·r, r=50 semicircle
  const dashOffset = (totalArc - (capped / MAX_RR) * totalArc).toFixed(1);
  const passes = rr >= gate;
  const arcColor = passes ? colors.bullish : colors.caution;
  const gateLabel = `${gate.toFixed(1)}:1`;

  // Point on the semicircle (center 60,65 · r 50) at fraction f (0 = left, 1 = right).
  const cx = 60;
  const cy = 65;
  const r = 50;
  const arcPoint = (f: number, radius = r) => {
    const a = (1 - Math.min(Math.max(f, 0), 1)) * Math.PI;
    return { x: cx + radius * Math.cos(a), y: cy - radius * Math.sin(a) };
  };
  const thrFrac = gate / MAX_RR;
  const thrInner = arcPoint(thrFrac, r - 7);
  const thrOuter = arcPoint(thrFrac, r + 7);
  const cur = arcPoint(capped / MAX_RR); // current-position dot

  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing[4] }}>
      <svg viewBox="0 0 120 78" width={110} height={70} style={{ flexShrink: 0 }}>
        {/* track */}
        <path
          d="M10 65 A 50 50 0 0 1 110 65"
          fill="none"
          stroke={colors.surfaceMuted ?? colors.border}
          strokeWidth={9}
          strokeLinecap="round"
        />
        {/* fill (grows from left with the ratio) */}
        <path
          d="M10 65 A 50 50 0 0 1 110 65"
          fill="none"
          stroke={arcColor}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={totalArc}
          strokeDashoffset={dashOffset}
        />
        {/* desk min R/R threshold marker */}
        <line
          x1={thrInner.x}
          y1={thrInner.y}
          x2={thrOuter.x}
          y2={thrOuter.y}
          stroke={colors.text}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <text x={thrOuter.x - 3} y={thrOuter.y - 3} fontSize={7} fontWeight={700} fill={colors.textMuted}>
          {gateLabel}
        </text>
        {/* current-position dot */}
        <circle cx={cur.x} cy={cur.y} r={4.5} fill={arcColor} stroke={colors.surface} strokeWidth={2} />
      </svg>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: typography.scale["2xl"],
            fontWeight: 700,
            color: colors.text,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1
          }}
        >
          {rr.toFixed(1)}
          <span style={{ color: colors.textMuted }}>:1</span>
        </p>
        {/* Explicit order so the ratio is never ambiguous: reward then risk. */}
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          reward : risk
        </p>
        <p style={{ margin: "5px 0 0", fontSize: typography.scale.xs, color: arcColor }}>
          {passes ? `Clears ${gateLabel} threshold` : `Below ${gateLabel} threshold`}
        </p>
        {riskAmount != null && rewardAmount != null ? (
          <p style={{ margin: "2px 0 0", fontSize: typography.scale.xs, color: colors.textMuted }}>
            reward ${rewardAmount.toFixed(2)} · risk ${riskAmount.toFixed(2)}
          </p>
        ) : null}
      </div>
    </div>
  );
}



export function DeepDive({
  card,
  allCards = [],
  companyBySymbol,
  snapshot,
  onBackToBrief,
  isMobile = false,
  colors,
  dataRefreshNonce = 0
}: {
  card: FeedCard;
  /** Full feed list — used to know the other lane's state for the toggle. */
  allCards?: FeedCard[];
  /** Fallback map for company names not yet set on the card. */
  companyBySymbol?: Map<string, string>;
  /** Live quote from dashboard tape when the feed card has no price yet. */
  snapshot?: SnapshotPayload | null;
  onBackToBrief: () => void;
  isMobile?: boolean;
  colors: Colors;
  /** Bumped by periodic or per-card refresh to re-fetch all tab data. */
  dataRefreshNonce?: number;
}) {
  const [tab, setTab] = useState<DeepDiveTab>("setup");
  const [showBriefDetails, setShowBriefDetails] = useState(false);
  // activeLane allows switching Day/Swing within the deep dive
  const [activeLane, setActiveLane] = useState<"day" | "swing">(card.lane);

  // Sync activeLane when card changes (fixes loading issue when clicking different signals)
  useEffect(() => {
    setActiveLane(card.lane);
  }, [card.symbol, card.lane]);

  const symbolName = useSymbolName(card.symbol);

  const [quoteSnapshot, setQuoteSnapshot] = useState<SnapshotPayload | null>(snapshot ?? null);
  useEffect(() => {
    setQuoteSnapshot(snapshot ?? null);
  }, [snapshot, card.symbol]);

  useEffect(() => {
    const hasPrice =
      positivePrice(card.price) != null || resolveSnapshotDisplayPrice(snapshot) != null;
    const hasCompany = Boolean(
      card.company?.trim() ||
        companyBySymbol?.get(card.symbol.trim().toUpperCase())?.trim() ||
        symbolName?.trim() ||
        quoteSnapshot?.company_name?.trim()
    );
    if (hasPrice && hasCompany) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(card.symbol)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const row = Array.isArray(json.snapshots) ? json.snapshots[0] : null;
        if (!cancelled && row) setQuoteSnapshot(row);
      } catch {
        /* quote is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.symbol, card.price, card.company, snapshot, companyBySymbol, symbolName, quoteSnapshot?.company_name]);

  const resolvedCompany = useMemo(() => {
    const sym = card.symbol.trim().toUpperCase();
    const pick = (...candidates: (string | null | undefined)[]) => {
      for (const c of candidates) {
        const t = c?.trim();
        if (t) return t;
      }
      return null;
    };
    return pick(
      card.company,
      companyBySymbol?.get(sym),
      symbolName,
      quoteSnapshot?.company_name,
      snapshot?.company_name
    );
  }, [
    card.company,
    card.symbol,
    companyBySymbol,
    symbolName,
    quoteSnapshot?.company_name,
    snapshot?.company_name
  ]);

  // Derive per-lane state for the toggle — null means no card in the feed.
  const dayLaneCard = allCards.find((c) => c.symbol === card.symbol && c.lane === "day") ?? null;
  const swingLaneCard = allCards.find((c) => c.symbol === card.symbol && c.lane === "swing") ?? null;
  // If we're viewing a card that's in the feed but the feed list wasn't passed,
  // fall back to the card itself so its own lane is never shown as unavailable.
  const dayState: FeedState | null = dayLaneCard?.state ?? (card.lane === "day" ? card.state : null);
  const swingState: FeedState | null = swingLaneCard?.state ?? (card.lane === "swing" ? card.state : null);
  const { composite, isInitialLoading, isRevalidating, transportError, fetchErrorMessage } =
    useSignalComposite(card.symbol, activeLane);

  const displayPrice = useMemo(() => {
    return (
      positivePrice(card.price) ??
      resolveSnapshotDisplayPrice(quoteSnapshot) ??
      resolveSnapshotDisplayPrice(snapshot) ??
      positivePrice((composite as Record<string, unknown> | null)?.last_trade_price) ??
      null
    );
  }, [card.price, quoteSnapshot, snapshot, composite]);

  const displayChangePct = useMemo(() => {
    if (card.changePct != null && Number.isFinite(card.changePct)) return card.changePct;
    const fromSnap = quoteSnapshot?.change_percent ?? snapshot?.change_percent;
    return typeof fromSnap === "number" && Number.isFinite(fromSnap) ? fromSnap : null;
  }, [card.changePct, quoteSnapshot, snapshot]);

  useEffect(() => {
    if (dataRefreshNonce <= 0) return;
    const sym = card.symbol.trim().toUpperCase();
    void revalidateSignalCompositeCache(sym, activeLane);
  }, [dataRefreshNonce, card.symbol, activeLane]);

  // ── Full signals-page computation pipeline ─────────────────────────────────
  const insight = useMemo(() => (composite ? parseSwingCompositeInsight(composite) : null), [composite]);
  const layerRows = useMemo(() => compositeToSignalsLayerRows(composite), [composite]);
  const setupBias: SignalsSetupBias = useMemo(
    () => deriveSetupBiasFromComposite(composite, layerRows),
    [composite, layerRows]
  );
  const hasRenderableComposite =
    composite != null && !isNonRenderableCompositeResponse(composite);
  const isInsufficient = !hasRenderableComposite;
  const allowsScenarioGeometry = feedCardAllowsScenarioGeometry(card);

  const unavailableMessage = useMemo(
    () =>
      resolveDeepDiveUnavailableMessage({
        symbol: card.symbol,
        cardVerdict: card.verdict,
        composite,
        transportError,
        fetchErrorMessage
      }),
    [card.symbol, card.verdict, composite, transportError, fetchErrorMessage]
  );

  const compositeAlignmentRatio = useMemo(() => {
    if (isInsufficient) return null;
    const ar = (composite as Record<string, unknown>).alignment_ratio;
    return typeof ar === "number" && Number.isFinite(ar) ? ar : null;
  }, [composite, isInsufficient]);

  const layerAlignmentLine = useMemo(() => {
    if (isInsufficient) return null;
    return resolveCompositeLayerAlignment({
      rows: layerRows,
      bias: setupBias,
      alignmentRatio: compositeAlignmentRatio,
      compositeDirection: parseCompositeDirectionFields(composite as Record<string, unknown>)
    }).displayLine;
  }, [isInsufficient, layerRows, setupBias, compositeAlignmentRatio, composite]);

  const layerSignalSummary = useMemo(() => {
    if (!isInsufficient && typeof (composite as Record<string, unknown>).signal_summary === "string") {
      const s = String((composite as Record<string, unknown>).signal_summary);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }
    return setupBias;
  }, [composite, isInsufficient, setupBias]);

  const marketEnvironment = useMemo(
    () => (composite ? parseMarketEnvironment(composite as Record<string, unknown>) : null),
    [composite]
  );
  const marketContextFlags = useMemo(
    () => (composite ? parseMarketContextFlags(composite as Record<string, unknown>) : null),
    [composite]
  );
  const marketContextDampening = useMemo(
    () => (composite ? parseMarketContextDampening(composite as Record<string, unknown>) : null),
    [composite]
  );
  const deskMinRr = useMemo(
    () => minRrForDeskMode(marketEnvironment, activeLane),
    [marketEnvironment, activeLane]
  );

  const pageDecision = useMemo(() => {
    if (isInsufficient) return null;
    const c = composite as Record<string, unknown>;
    const { riskReward: rr, rrWarning } = resolveCompositeRiskRewardForDecision(c, deskMinRr);
    const ar = typeof c.alignment_ratio === "number" ? c.alignment_ratio : null;
    const tfCtx = resolveTimeframeContext(c, activeLane);
    return buildSignalsPageDecision({
      mode: activeLane,
      bias: setupBias,
      rows: layerRows,
      alignmentRatio: ar,
      riskReward: rr,
      rrWarning,
      isComplete: c.is_complete !== false,
      counterTrend: parseCompositeAlignment(composite)?.is_counter_trend === true,
      timeframeCounterTrend: isTimeframeCounterTrend(tfCtx)
    });
  }, [composite, isInsufficient, setupBias, layerRows, activeLane, deskMinRr]);

  const previewBlockingLayers = useMemo(
    () => pickPreviewLayers(layerRows, setupBias, 3),
    [layerRows, setupBias]
  );

  const causalNarrative = useMemo(() => {
    if (isInsufficient) return null;
    const c = composite as Record<string, unknown>;
    return resolveCausalNarrative({
      apiPayload: c.causal_narrative,
      signalSummary: layerSignalSummary,
      rows: layerRows,
      executionNote: pageDecision?.rationale?.text ?? null
    });
  }, [composite, isInsufficient, layerSignalSummary, layerRows, pageDecision?.rationale?.text]);

  const timeframeContext = useMemo(() => {
    if (isInsufficient) return null;
    return resolveTimeframeContext(composite as Record<string, unknown>, activeLane);
  }, [composite, isInsufficient, activeLane]);

  const ledgerGateSummary = useMemo(
    () => (composite ? parseLedgerGateSummary(composite as Record<string, unknown>) : null),
    [composite]
  );
  const apiDecisionState = useMemo((): TradeDecisionState | null => {
    if (!composite) return null;
    return (
      parseApiDecisionState((composite as Record<string, unknown>).decision_state) ??
      (pageDecision?.state as TradeDecisionState | undefined) ??
      null
    );
  }, [composite, pageDecision?.state]);

  const setupJudgment = useMemo(() => {
    if (isInsufficient) return null;
    return resolveSetupJudgmentFromComposite(composite as Record<string, unknown>, {
      mode: activeLane,
      rows: layerRows,
      bias: setupBias,
      alignmentRatio: compositeAlignmentRatio
    });
  }, [composite, isInsufficient, activeLane, layerRows, setupBias, compositeAlignmentRatio]);

  // Publish full-depth per-symbol context to the Assistant while this deep dive is open — the
  // same context the Signals desk publishes (decision, layers, readiness, R/R, regime, causal
  // chain), built from the same composite via the shared builder. Publishing `trading_mode`
  // resolves the correct desk cache so the chatbot never claims it lacks the on-screen symbol.
  // The publisher clears this automatically when the deep dive closes (component unmount).
  const assistantContext = useMemo<AssistantPageContext | null>(
    () =>
      buildSignalsPageAssistantContext({
        pageId: "dashboard/trading-room",
        tradingMode: activeLane,
        symbol: card.symbol,
        symbolCommitted: true,
        hasValidSignal: hasRenderableComposite && pageDecision != null,
        compositeLoading: isInitialLoading,
        isInsufficientComposite: isInsufficient,
        pageDecision,
        signalsPresentRows: layerRows,
        setupBias,
        compositeAlignmentRatio,
        layerAgreementPercent: null,
        setupJudgment,
        compositeResult: hasRenderableComposite ? (composite as Record<string, unknown>) : null,
        causalNarrativeSummary: causalNarrative?.summary ?? null,
        causalBlockingChain: causalNarrative?.chainLabel ?? null,
        timeframeAlignmentLabel: timeframeContext?.alignment.label ?? null,
        marketEnvironment,
        regularSessionOpen: null,
        gapIntelSnapshot: null,
        signalEvidence: null
      }),
    [
      activeLane,
      card.symbol,
      hasRenderableComposite,
      isInitialLoading,
      isInsufficient,
      pageDecision,
      layerRows,
      setupBias,
      compositeAlignmentRatio,
      setupJudgment,
      composite,
      causalNarrative?.summary,
      causalNarrative?.chainLabel,
      timeframeContext?.alignment.label,
      marketEnvironment
    ]
  );
  usePublishAssistantContext(assistantContext);

  const referenceLevels = useMemo(() => {
    const snap = coerceSnapshotForReferenceLevels({
      symbol: card.symbol,
      last_trade_price: card.price ?? undefined
    });
    const comp = isInsufficient ? null : (composite as Record<string, unknown>);
    return deriveSessionReferenceLevels(snap, comp);
  }, [card.symbol, card.price, composite, isInsufficient]);

  // Signal-engine overlay for the rich trading chart (entry zone band, swing
  // range, stop, T1/T2, prev close) — all sourced from the same composite so
  // the chart never contradicts the signal card.
  const signalOverlay = useMemo<ChartSignalOverlay | undefined>(() => {
    if (isInsufficient) return undefined;
    const c = composite as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    const zone = (v: unknown): { low: number; high: number } | null => {
      if (!v || typeof v !== "object") return null;
      const z = v as Record<string, unknown>;
      const lo = num(z.low);
      const hi = num(z.high);
      return lo != null && hi != null && hi > lo ? { low: lo, high: hi } : null;
    };
    return {
      entryZone: zone(c.historical_entry_zone ?? c.session_entry_zone),
      swingRange: zone(c.swing_range_zone),
      stop: num(c.reference_stop_level),
      target1: num(c.reference_target_1),
      target2: num(c.reference_target_2),
      prevClose: num(c.prev_close ?? c.previous_close)
    };
  }, [composite, isInsufficient]);

  // Charts-tab status dot. "entry" (green) when price is inside the entry zone
  // OR either lane is actionable; "caution" (amber) when price is near the stop
  // OR either lane is near. Reflects evaluation-time price, not a live tick —
  // kept conservative so it never implies real-time precision it doesn't have.
  const chartsDot = useMemo<"entry" | "caution" | null>(() => {
    const p = card.price;
    const priced = p != null && Number.isFinite(p);
    if (priced && signalOverlay?.entryZone) {
      const { low, high } = signalOverlay.entryZone;
      if (p! >= low && p! <= high) return "entry";
    }
    if (dayState === "actionable" || swingState === "actionable") return "entry";
    if (priced && signalOverlay?.stop && signalOverlay.stop > 0) {
      if (Math.abs(p! - signalOverlay.stop) / signalOverlay.stop <= 0.01) return "caution";
    }
    if (dayState === "near" || swingState === "near") return "caution";
    return null;
  }, [card.price, signalOverlay, dayState, swingState]);

  const riskReward = useMemo(() => {
    if (isInsufficient) return null;
    const c = composite as Record<string, unknown>;
    return (
      parsePositiveRiskReward(c.structure_risk_reward) ??
      parsePositiveRiskReward(c.risk_reward)
    );
  }, [composite, isInsufficient]);

  const geometryTradeable = useMemo(() => {
    if (isInsufficient) return false;
    const c = composite as Record<string, unknown>;
    if (c.geometry_tradeable === false || c.desk_surface_eligible === false) return false;
    return true;
  }, [composite, isInsufficient]);

  const geometryBlockReason = useMemo(() => {
    if (isInsufficient) return null;
    const raw = (composite as Record<string, unknown>).geometry_block_reason;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }, [composite, isInsufficient]);

  // Single source of truth for the scenario panel: stop / entry zone / target,
  // the current-price marker, and the dollar risk/reward. Prefers the engine's
  // real reference levels (reference_stop_level, reference_target_1/2,
  // historical_entry_zone) so the geometry, the dollar amounts, AND the R/R
  // gauge ratio all reconcile. Mirrors the backend R/R math exactly: entry is
  // the current price (`last`), R/R = reward/risk, preferring T1 unless T1 is
  // sub-1:1 and T2 improves it (see risk_reward_structure.py). Falls back to
  // session-derived support/resistance only when the engine omits a level.
  const displayDirection = useMemo(
    () => resolveDeepDiveDirection(setupBias, !isInsufficient, card.bias),
    [setupBias, isInsufficient, card.bias]
  );

  const scenario = useMemo(() => {
    const price = displayPrice;
    if (price == null || !Number.isFinite(price)) return null;
    const isLong = setupBias !== "Bearish";
    const stopPrice =
      signalOverlay?.stop ??
      (referenceLevels.support != null ? referenceLevels.support * 0.997 : price * (isLong ? 0.97 : 1.03));
    const t1 = signalOverlay?.target1 ?? referenceLevels.resistance ?? price * (isLong ? 1.025 : 0.975);
    const t2 = signalOverlay?.target2 ?? null;
    const target2Provenance = parseTarget2Provenance(
      isInsufficient ? null : (composite as Record<string, unknown>).reference_target_2_provenance
    );
    const entryLow = signalOverlay?.entryZone?.low ?? price * 0.997;
    const entryHigh = signalOverlay?.entryZone?.high ?? price * 1.003;

    const rrFor = (target: number) => {
      const risk = isLong ? price - stopPrice : stopPrice - price;
      const reward = isLong ? target - price : price - target;
      if (risk <= 1e-6 || reward <= 1e-6) return null;
      return { risk, reward, ratio: reward / risk, target };
    };
    const rrT1 = rrFor(t1);
    const rrT2 = t2 != null ? rrFor(t2) : null;
    const structureRr = isLong
      ? structureRiskRewardLong(price, t1, stopPrice, t2, target2Provenance)
      : structureRiskRewardShort(price, t1, stopPrice, t2, target2Provenance);

    let chosen = rrT1;
    let chosenLabel: "T1" | "T2" = "T1";
    if (structureRr != null && rrT2 && rrT1 && rrT1.ratio < 1 && target2Provenance === "resistance") {
      chosen = rrT2;
      chosenLabel = "T2";
    } else if (structureRr != null && rrT1) {
      chosen = rrT1;
      chosenLabel = "T1";
    } else if (structureRr == null && rrT1) {
      chosen = rrT1;
      chosenLabel = "T1";
    } else if (rrT2) {
      chosen = rrT2;
      chosenLabel = "T2";
    }
    const targetPrice = chosen?.target ?? t1;
    const gateFails =
      structureRr == null &&
      rrT1 != null &&
      rrT1.ratio < 1 &&
      t2 != null &&
      target2Provenance != null &&
      target2Provenance !== "resistance";
    const t1TooClose = rrT1 != null && rrT1.ratio < 1;
    const provenanceDirection: "bullish" | "bearish" = isLong ? "bullish" : "bearish";
    const c = (isInsufficient ? {} : composite) as Record<string, unknown>;
    const ezQuality =
      typeof c.entry_zone_quality === "string" ? (c.entry_zone_quality as string) : null;
    const worstCaseRr =
      typeof c.entry_zone_worst_case_rr === "number" && Number.isFinite(c.entry_zone_worst_case_rr)
        ? (c.entry_zone_worst_case_rr as number)
        : null;
    const posNum = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    const vwap = posNum(c.vwap ?? c.day_vwap);
    const atr = posNum(c.atr);
    const entryStyle = parseEntryStyle(c.entry_style);
    const entryAnchor = posNum(c.entry_anchor);
    const entryDistanceAtr = posNum(c.entry_distance_atr);
    const zoneWidthAtr = posNum(c.zone_width_atr);
    const entryDistanceTier = parseEntryDistanceTier(c.entry_distance_tier);
    const entryQualityTier = parseEntryQualityTier(c.entry_quality_tier);
    const idealPullbackRaw = c.ideal_pullback_zone;
    const idealPullbackZone =
      idealPullbackRaw &&
      typeof idealPullbackRaw === "object" &&
      !Array.isArray(idealPullbackRaw) &&
      posNum((idealPullbackRaw as { low?: unknown }).low) != null &&
      posNum((idealPullbackRaw as { high?: unknown }).high) != null
        ? {
            low: posNum((idealPullbackRaw as { low?: unknown }).low)!,
            high: posNum((idealPullbackRaw as { high?: unknown }).high)!
          }
        : null;

    return {
      currentPrice: price,
      stopPrice,
      targetPrice,
      target1: t1,
      target2: t2,
      entryLow,
      entryHigh,
      riskAmount: chosen?.risk ?? null,
      rewardAmount: chosen?.reward ?? null,
      chosenLabel,
      rrToT1: rrT1?.ratio ?? null,
      rrToT2: rrT2?.ratio ?? null,
      entryZoneQuality: ezQuality,
      worstCaseRr,
      vwap,
      atr,
      entryStyle,
      entryAnchor,
      entryDistanceAtr,
      zoneWidthAtr,
      entryDistanceTier,
      entryQualityTier,
      idealPullbackZone,
      displayRr: structureRr,
      target2Provenance,
      provenanceDirection,
      gateFails,
      t1TooClose,
      gateFailReason: gateFails
        ? t1TooClose
          ? `T1 too close to entry (${rrT1?.ratio.toFixed(1)}:1) — ${target2ProvenanceLabel(target2Provenance, provenanceDirection) ?? "extended target unanchored"}`
          : (target2ProvenanceLabel(target2Provenance, provenanceDirection) ?? "Extended target — unanchored")
        : null
    };
  }, [displayPrice, setupBias, signalOverlay, referenceLevels, composite, isInsufficient]);

  /** Side-by-side geometry bar + gauge only when the price ladder is shown. */
  const scenarioSideBySide = Boolean(scenario && geometryTradeable);

  const currentRr = scenario?.displayRr ?? null;

  const entryZoneWarning = useMemo(() => {
    if (!scenario) return null;
    if (scenario.entryZoneQuality === "no_clean_entry") {
      const gate = `${deskMinRr.toFixed(1)}:1`;
      const lines = [
        "No clean entry band — stop and target are too tight for a validated zone near current price."
      ];
      if (scenario.worstCaseRr != null) {
        lines.push(
          `R/R from entry zone top → ${scenario.chosenLabel}: ${scenario.worstCaseRr.toFixed(1)}:1 — still below the ${gate} desk gate.`
        );
      }
      lines.push("Do not enter at current price — wait for a better structure.");
      return lines;
    }
    const position = resolveEntryZonePosition(scenario.currentPrice, scenario.entryLow, scenario.entryHigh);
    const lines = buildEntryZoneRrWarning({
      position,
      currentPrice: scenario.currentPrice,
      entryLow: scenario.entryLow,
      entryHigh: scenario.entryHigh,
      currentRr,
      zoneEdgeRr: scenario.worstCaseRr,
      chosenLabel: scenario.chosenLabel,
      minRr: deskMinRr
    });
    const chase = buildEntryDistanceWarning({
      distanceTier: scenario.entryDistanceTier ?? null,
      distanceAtr: scenario.entryDistanceAtr ?? null,
      anchor: scenario.entryAnchor ?? null
    });
    if (chase) lines.push(chase);
    return lines.length > 0 ? lines : null;
  }, [scenario, currentRr, deskMinRr]);

  const scenarioRrFixGuidance = useMemo(() => {
    if (!scenario || setupBias === "Neutral") return null;
    const direction = setupBias === "Bearish" ? "bearish" : "bullish";
    const rr =
      currentRr ??
      (direction === "bullish"
        ? structureRiskRewardLong(
            scenario.currentPrice,
            scenario.targetPrice,
            scenario.stopPrice,
            scenario.target2,
            scenario.target2Provenance
          )
        : structureRiskRewardShort(
            scenario.currentPrice,
            scenario.targetPrice,
            scenario.stopPrice,
            scenario.target2,
            scenario.target2Provenance
          ));
    if (rr == null || rr >= deskMinRr) return null;
    return buildScenarioRrFixGuidance(
      {
        entry: scenario.currentPrice,
        stop: scenario.stopPrice,
        target: scenario.targetPrice,
        riskReward: rr
      },
      direction,
      {
        target1: scenario.target1,
        target2: scenario.target2,
        structuralStop: scenario.stopPrice,
        entryZoneLow: scenario.entryLow,
        entryZoneHigh: scenario.entryHigh
      },
      deskMinRr
    );
  }, [scenario, setupBias, currentRr, deskMinRr]);

  const executionActionable = useMemo(() => {
    if (!composite || isInsufficient) return null;
    const raw = (composite as Record<string, unknown>).execution_actionable;
    return typeof raw === "boolean" ? raw : null;
  }, [composite, isInsufficient]);

  const { plan: trackedPlan, refresh: refreshTrackedPlan } = useTrackedPlan(card.symbol, activeLane);

  const livePlanAssessment = useMemo(() => {
    return buildLiveAssessmentFromDeepDive({
      currentPrice: displayPrice,
      setupBias,
      decisionState: apiDecisionState,
      executionActionable,
      entryZoneQuality: scenario?.entryZoneQuality ?? null,
      entryLow: scenario?.entryLow ?? null,
      entryHigh: scenario?.entryHigh ?? null,
      currentRr: currentRr ?? scenario?.displayRr ?? null,
      isInsufficient,
      layersAligned: setupJudgment?.process.layersAligned ?? null,
      layersTotal: setupJudgment?.process.layersTotal ?? null
    });
  }, [
    displayPrice,
    setupBias,
    apiDecisionState,
    executionActionable,
    scenario,
    currentRr,
    isInsufficient,
    setupJudgment
  ]);

  const planDiff = useMemo(() => {
    if (!trackedPlan) return null;
    return resolveLiveVsPlanDiff(trackedPlan, livePlanAssessment, deskMinRr);
  }, [trackedPlan, livePlanAssessment, deskMinRr]);

  const dataQualityFlags = useMemo(
    () =>
      buildDataQualityFlags({
        isInsufficient,
        unavailableMessage: unavailableMessage,
        entryZoneQuality: scenario?.entryZoneQuality ?? null,
        layersAligned: setupJudgment?.process.layersAligned ?? null,
        layersTotal: setupJudgment?.process.layersTotal ?? null
      }),
    [isInsufficient, unavailableMessage, scenario, setupJudgment]
  );

  const triggerDisplay = useMemo(
    () => resolveTriggerDisplay(livePlanAssessment, deskMinRr),
    [livePlanAssessment, deskMinRr]
  );

  const handleTrackPlan = () => {
    if (!scenario || isInsufficient || setupBias === "Neutral") return;
    const plan = buildTrackedPlanFromDeepDive({
      symbol: card.symbol,
      mode: activeLane,
      setupBias,
      layersAligned: setupJudgment?.process.layersAligned ?? null,
      layersTotal: setupJudgment?.process.layersTotal ?? null,
      scenario: {
        entryLow: scenario.entryLow,
        entryHigh: scenario.entryHigh,
        stopPrice: scenario.stopPrice,
        target1: scenario.target1,
        target2: scenario.target2,
        currentPrice: scenario.currentPrice,
        displayRr: scenario.displayRr ?? currentRr,
        entryZoneQuality: scenario.entryZoneQuality ?? null
      },
      composite: composite as Record<string, unknown>,
      verdictLine: pageDecision?.line ?? card.verdict,
      deskMinRr
    });
    saveTrackedPlan(plan);
    notifyTrackedPlanUpdated();
    refreshTrackedPlan();
    void pushTrackedPlanToServer(plan);
  };

  const handleClearPlan = () => {
    const id = trackedPlan?.id;
    removeTrackedPlanForSymbol(card.symbol, activeLane);
    notifyTrackedPlanUpdated();
    refreshTrackedPlan();
    if (id) void pushTrackedPlanRemovalToServer(id);
  };

  // Fundamental backdrop (swing only — matches signals page behaviour)
  const fundamentalSummary = useMemo<FundamentalBackdropSummary | null>(() => {
    if (activeLane !== "swing") return null;
    if (isInsufficient) return null;
    const c = composite as Record<string, unknown>;
    const ctx = parseFundamentalContext(c.fundamental_context);
    const daysRaw = c.earnings_days_away;
    const earningsDays = typeof daysRaw === "number" && Number.isFinite(daysRaw) ? Math.round(daysRaw) : null;
    const earningsRisk = typeof c.earnings_risk === "string" ? c.earnings_risk : null;
    const newsRow = layerRows.find((r) => r.key === "news");
    return buildFundamentalBackdropSummary({
      context: ctx,
      earningsDaysAway: earningsDays,
      earningsRisk,
      newsStatus: newsRow?.status,
      setupActionable: pageDecision?.state === "actionable"
    });
  }, [activeLane, composite, isInsufficient, layerRows, pageDecision?.state]);

  const brief = useMemo(() => {
    if (!allowsScenarioGeometry) {
      return (
        card.verdict?.trim() ||
        "Session activity — not a vetted setup. Momentum and context only; scenario geometry requires passing desk quality gates."
      );
    }
    return buildRichBrief({
        symbol: card.symbol,
        direction: displayDirection.direction,
        insight,
        layerRows,
        setupBias,
        pageDecisionState: pageDecision?.state ?? null,
        causalSummary: causalNarrative?.summary ?? null,
        causalChainLabel: causalNarrative?.chainLabel ?? null,
        setupJudgment,
        currentRr,
        activeLane,
        deskMinRr,
        verdictFallback: card.verdict
      });
  }, [
    allowsScenarioGeometry,
    card.symbol,
    card.verdict,
    displayDirection.direction,
    insight,
    layerRows,
    setupBias,
    pageDecision?.state,
    causalNarrative?.summary,
    causalNarrative?.chainLabel,
    setupJudgment,
    currentRr,
    activeLane,
    deskMinRr
  ]);

  // Jargon-free default read; the detailed `brief` above sits behind a "details" toggle.
  const plainSummary = useMemo(() => {
    if (!allowsScenarioGeometry) return brief;
    return buildPlainSummary({
      symbol: card.symbol,
      direction: displayDirection.direction,
      activeLane,
      layersAligned: setupJudgment?.process.layersAligned ?? null,
      layersTotal: setupJudgment?.process.layersTotal ?? null,
      decisionState: pageDecision?.state ?? null,
      primaryBlocker: setupJudgment?.primaryBlocker ?? null,
      currentRr,
      deskMinRr,
      fallback: brief
    });
  }, [
    allowsScenarioGeometry,
    brief,
    card.symbol,
    displayDirection.direction,
    activeLane,
    setupJudgment,
    pageDecision?.state,
    currentRr,
    deskMinRr
  ]);

  const hasComposite = !isInsufficient;
  const verdictLabel = resolveDeepDiveVerdictLabel(card.state, apiDecisionState, hasComposite);
  const verdictTone = resolveDeepDiveVerdictTone(card.state, apiDecisionState, hasComposite);
  const sTone =
    verdictTone === "bullish"
      ? colors.bullish
      : verdictTone === "caution"
        ? colors.caution
        : verdictTone === "bearish"
          ? colors.bearish
          : verdictTone === "muted"
            ? colors.textMuted
            : stateTone(card.state, colors);
  const pct = displayChangePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  const laneAccent = activeLane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const directionColor =
    displayDirection.direction === "long"
      ? colors.bullish
      : displayDirection.direction === "short"
        ? colors.bearish
        : colors.textMuted;
  // B79 — direction confidence chip (how much to trust bullish/bearish, not entries/targets).
  const dirConfTier = insight?.direction_confidence ?? null;
  const dirConfTone =
    dirConfTier === "High" ? colors.bullish : dirConfTier === "Moderate" ? colors.caution : colors.textMuted;
  const loading = isInitialLoading || (isRevalidating && !hasRenderableComposite);

  const evalTime = useMemo(() => {
    const raw = (composite as Record<string, unknown> | null)?.generated_at;
    if (!raw || typeof raw !== "string") return null;
    try {
      return new Date(raw).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }) + " ET";
    } catch {
      return null;
    }
  }, [composite]);

  // Session-aware: day setups are only valid during regular market hours.
  const dayMarketClosed = activeLane === "day" && !isUsRegularSessionOpenEt();
  const nextOpenLabel = dayMarketClosed ? nextRegularSessionOpenLabel() : null;

  const briefMeta = useMemo(() => {
    if (!setupJudgment) return null;
    return buildBriefMetaLine({
      bias: setupBias,
      rows: layerRows,
      timingFlagCount: setupJudgment.tradeability.flags.length
    });
  }, [setupJudgment, setupBias, layerRows]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <button
        type="button"
        onClick={onBackToBrief}
        style={{
          alignSelf: "flex-start",
          border: "none",
          background: "transparent",
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0
        }}
      >
        ← Session brief
      </button>

      {/* ── Verdict Banner: standalone card with thick left border ── */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `5px solid ${directionColor}`,
          borderRadius: borderRadius.lg,
          padding: `${spacing[3]} ${spacing[4]}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing[2]
        }}
      >
        {/* Row 1: verdict + symbol · Day/Swing (center on desktop, beside symbol on mobile) · Watching */}
        <div
          style={
            isMobile
              ? {
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: spacing[2],
                  width: "100%"
                }
              : {
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                  alignItems: "center",
                  gap: spacing[2],
                  width: "100%"
                }
          }
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing[2],
              flexWrap: "wrap",
              minWidth: 0,
              justifySelf: isMobile ? undefined : "start"
            }}
          >
            <span
              style={{
                fontSize: typography.scale.base,
                fontWeight: 700,
                color: directionColor,
                letterSpacing: "0.06em"
              }}
            >
              {displayDirection.bannerLabel}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>·</span>
            <span style={{ fontSize: typography.scale.xl, fontWeight: 800, letterSpacing: "0.02em", color: colors.text }}>
              {card.symbol}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>·</span>
            <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: sTone, letterSpacing: "0.02em" }}>
              {verdictLabel}
            </span>
            {dirConfTier ? (
              <span
                data-testid="deep-dive-direction-confidence"
                title={insight?.direction_confidence_reason || undefined}
                style={{
                  fontSize: typography.scale.xs,
                  fontWeight: 700,
                  padding: "1px 8px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  color: dirConfTone,
                  border: `1px solid ${dirConfTone}`,
                  background: `color-mix(in srgb, ${dirConfTone} 12%, transparent)`
                }}
              >
                {dirConfTier} confidence
              </span>
            ) : null}
          </div>
          <LaneToggle
            activeLane={activeLane}
            onChange={setActiveLane}
            dayState={dayState}
            swingState={swingState}
            symbol={card.symbol}
            colors={colors}
          />
          <div
            style={{
              justifySelf: isMobile ? undefined : "end",
              marginLeft: isMobile ? "auto" : undefined
            }}
          >
            <AddToWatchlistButton symbol={card.symbol} />
          </div>
        </div>

        {/* Row 2: Company · Price ±%  |  Evaluated timestamp */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: spacing[2], flexWrap: "wrap" }}>
            {resolvedCompany ? (
              <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, fontWeight: 500 }}>
                {resolvedCompany}
              </span>
            ) : null}
            {displayPrice != null ? (
              <>
                {resolvedCompany ? (
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>·</span>
                ) : null}
                <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
                  {fmtPrice(displayPrice)}
                </span>
                {pct != null ? (
                  <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone }}>
                    {fmtPct(pct)}
                  </span>
                ) : null}
              </>
            ) : resolvedCompany ? (
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Quote loading…</span>
            ) : (
              <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
                Quote unavailable
              </span>
            )}
          </div>
          {evalTime ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, whiteSpace: "nowrap" }}>
              Evaluated {evalTime}
            </span>
          ) : null}
        </div>
        {!isInsufficient && allowsScenarioGeometry ? (
          <p
            data-testid="deep-dive-trigger-line"
            style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
          >
            <span style={{ fontWeight: 700, color: colors.text }}>Trigger: </span>
            {triggerDisplay.label}
            <span style={{ color: colors.textMuted }}> — {triggerDisplay.hint}</span>
          </p>
        ) : null}
      </div>

      {/* ── Plain-English Brief: prototype-matching card ── */}
      <div
        style={{
          background: colors.surfaceMuted,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: `${spacing[3]} ${spacing[4]}`
        }}
      >
        {/* Micro-label: PLAIN-ENGLISH BRIEF */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Plain-English Brief
        </span>
        {/* brief text with left accent bar */}
        <div
          style={{
            marginTop: spacing[2],
            paddingLeft: spacing[3],
            borderLeft: `3px solid ${laneAccent}`
          }}
        >
          <p style={{ margin: 0, fontSize: typography.scale.base, lineHeight: 1.7, color: colors.text }}>
            {plainSummary}
          </p>
          {allowsScenarioGeometry && brief && brief !== plainSummary ? (
            <div style={{ marginTop: spacing[2] }}>
              <button
                type="button"
                onClick={() => setShowBriefDetails((v) => !v)}
                aria-expanded={showBriefDetails}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  color: colors.accent
                }}
              >
                {showBriefDetails ? "Hide the detailed read ▴" : "Show the detailed read ▾"}
              </button>
              {showBriefDetails ? (
                <p
                  style={{
                    margin: `${spacing[2]} 0 0`,
                    fontSize: typography.scale.sm,
                    lineHeight: 1.7,
                    color: colors.textMuted
                  }}
                >
                  {brief}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {allowsScenarioGeometry ? (
          <AiSetupRead
            symbol={card.symbol}
            direction={displayDirection.direction}
            desk={activeLane}
            layers={layerRows.map((r) => ({ layer: r.key, status: r.status ?? "" }))}
            confirming={(insight?.confirming_signals ?? []).map((s) => s.label).filter(Boolean)}
            conflicting={(insight?.conflicting_signals ?? []).map((s) => s.label).filter(Boolean)}
            catalysts={(insight?.catalysts ?? []).map((c) => c.text).filter(Boolean)}
            timing={setupJudgment?.tradeability.label ?? ""}
            primaryBlocker={setupJudgment?.primaryBlocker ?? ""}
            marketRegime={insight?.market_regime ?? ""}
            fallbackText={brief}
            palette={{
              text: colors.text,
              textMuted: colors.textMuted,
              border: colors.border,
              accent: colors.accent,
              surface: colors.surfaceMuted
            }}
          />
        ) : null}
        {/* meta-line (the deep dive IS the full analysis — no cross-link to the retired signals page) */}
        {briefMeta ? (
          <div
            style={{
              marginTop: spacing[3],
              paddingTop: spacing[2],
              borderTop: `1px solid ${colors.border}`
            }}
          >
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{briefMeta}</span>
          </div>
        ) : null}
      </div>

      {marketEnvironment && apiDecisionState && allowsScenarioGeometry ? (
        <RiskStackPanel
          environment={marketEnvironment}
          signalState={apiDecisionState}
          insight={insight}
          ledgerGates={ledgerGateSummary}
          testId="trading-room-deep-dive-risk-stack"
        />
      ) : null}

      {marketContextFlags ? (
        <MarketContextPanel
          flags={marketContextFlags}
          dampening={marketContextDampening}
          compact
          testId="trading-room-deep-dive-market-context"
        />
      ) : null}

      {/* ── Tabs + tab content: one card ── */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: `${spacing[3]} ${spacing[4]}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing[3]
        }}
      >
      <SegTabs value={tab} onSelect={setTab} chartsDot={chartsDot} colors={colors} />

      {/* ── Tab panels — identical to the Signals page ──────────────────── */}
      <div style={{ minHeight: loading ? 220 : 120 }}>
        {loading ? (
          <div
            data-testid="deep-dive-loading"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing[3],
              padding: `${spacing[5]} ${spacing[3]}`,
              minHeight: 200
            }}
          >
            <ContentLoading compact />
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, textAlign: "center" }}>
              Loading live analysis for {card.symbol}…
            </p>
          </div>
        ) : null}
        {/* Session-aware day suppression banner */}
        {dayMarketClosed ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing[2],
              padding: `${spacing[2]} ${spacing[3]}`,
              background: "rgba(46,139,255,.08)",
              border: `1px solid rgba(46,139,255,.25)`,
              borderRadius: borderRadius.md,
              marginBottom: spacing[3]
            }}
          >
            <span style={{ fontSize: 14 }}>⏱</span>
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>
              <span style={{ color: colors.accent, fontWeight: 600 }}>Day setups resume at market open</span>
              {" — "}{nextOpenLabel}. Swing mode remains fully active.
            </p>
          </div>
        ) : null}
        {tab === "setup" && !loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            {!allowsScenarioGeometry ? (
              <SessionMoverContext
                card={card}
                company={resolvedCompany}
                price={displayPrice}
                changePct={displayChangePct}
                colors={colors}
              />
            ) : null}
            {allowsScenarioGeometry && !isInsufficient ? (
              <>
                {/* 1. Bias + layer force summary (prototype panel 1) */}
                <SignalsBiasRationalePanel
                  bias={setupBias}
                  rows={layerRows}
                  signalSummary={layerSignalSummary}
                  layerAlignmentLine={layerAlignmentLine}
                />
                {/* 3. Timeframe alignment (prototype panel 3) */}
                {timeframeContext ? (
                  <TimeframeContextPanel
                    context={timeframeContext}
                    tradingMode={activeLane}
                    setupBias={setupBias}
                    compact
                  />
                ) : null}
                {/* 4. Why layers read this way — shown for all states (prototype panel 4) */}
                {causalNarrative ? (
                  <CausalNarrativePanel narrative={causalNarrative} compact />
                ) : null}
                {/* 5. Setup judgment + execution read + conviction + fundamental backdrop (prototype panels 5 & 6 & 7) */}
                {pageDecision ? (
                  <SignalsSetupRead
                    symbol={card.symbol}
                    tradingMode={activeLane}
                    bias={setupBias}
                    rows={layerRows}
                    decision={pageDecision}
                    previewLayers={previewBlockingLayers}
                    alignmentRatio={compositeAlignmentRatio}
                    layout="desk"
                    setupJudgment={setupJudgment}
                    fundamentalSummary={fundamentalSummary}
                    riskReward={currentRr ?? riskReward}
                    minRiskReward={deskMinRr}
                  />
                ) : null}
                {allowsScenarioGeometry && !isInsufficient && scenario ? (
                  <TrackPlanPanel
                    plan={trackedPlan}
                    diff={planDiff}
                    onTrack={handleTrackPlan}
                    onClear={handleClearPlan}
                    trackingDisabled={setupBias === "Neutral"}
                    trackDisabledReason={
                      setupBias === "Neutral"
                        ? "Neutral setups cannot be tracked as directional plans."
                        : null
                    }
                    dataQualityFlags={dataQualityFlags}
                    colors={colors}
                  />
                ) : null}
                {/* 6. Scenario geometry + R/R gauge side-by-side + Copy scenario */}
                {displayPrice != null ? (
                  <article
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      padding: `${spacing[3]} ${spacing[4]}`
                    }}
                  >
                    {/* One row: Scenario geometry (left) | R/R gauge (right) when ladder shown; stack when not tradable. */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: scenarioSideBySide ? "minmax(0, 1fr) minmax(240px, 320px)" : "1fr",
                        gap: spacing[4],
                        alignItems: "start"
                      }}
                    >
                      {/* Left: Scenario geometry */}
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "1.4px",
                            textTransform: "uppercase",
                            color: colors.textMuted
                          }}
                        >
                          Scenario geometry
                        </p>
                        {scenario && geometryTradeable ? (
                          <ScenarioGeometry
                            currentPrice={scenario.currentPrice}
                            stopPrice={scenario.stopPrice}
                            targetPrice={scenario.targetPrice}
                            target1={scenario.target1}
                            target2={scenario.target2}
                            chosenLabel={scenario.chosenLabel}
                            entryLow={scenario.entryLow}
                            entryHigh={scenario.entryHigh}
                            isShort={setupBias === "Bearish"}
                            colors={colors}
                          />
                        ) : scenario && !geometryTradeable ? (
                          <p
                            data-testid="geometry-not-tradeable"
                            style={{
                              margin: "8px 0 0",
                              fontSize: typography.scale.sm,
                              lineHeight: 1.5,
                              color: colors.caution,
                              fontWeight: 600
                            }}
                          >
                            Not tradable at current structure
                            {geometryBlockReason ? ` (${geometryBlockReason.replace(/_/g, " ")})` : ""} — no
                            validated stop/target plan. Search this symbol for layer context only, or wait for a
                            pullback that clears desk geometry.
                          </p>
                        ) : null}
                        {scenario?.t1TooClose ? (
                          <p
                            data-testid="t1-too-close-warning"
                            style={{
                              margin: "8px 0 0",
                              fontSize: typography.scale.xs,
                              lineHeight: 1.5,
                              color: colors.caution,
                              fontWeight: 600
                            }}
                          >
                            T1 too close to entry
                            {scenario.rrToT1 != null ? ` (${scenario.rrToT1.toFixed(1)}:1)` : ""} — extended target required for desk gate.
                          </p>
                        ) : null}
                        {scenario?.target2Provenance && scenario.target2 != null ? (
                          <p style={{ margin: "6px 0 0", fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                            T2: {target2ProvenanceLabel(scenario.target2Provenance, scenario.provenanceDirection) ?? scenario.target2Provenance}
                          </p>
                        ) : null}
                        {scenario?.entryZoneQuality === "clamped" ? (
                          <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.textMuted }}>
                            Entry zone tightened so even the top of the band keeps an acceptable reward-to-risk.
                          </p>
                        ) : scenario?.entryZoneQuality === "no_clean_entry" ? (
                          <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.caution, fontWeight: 600 }}>
                            No clean entry: stop and target are too close to carve a band with acceptable reward-to-risk — wait for a better structure.
                          </p>
                        ) : null}
                        {scenario?.entryStyle ? (
                          <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.textMuted }}>
                            {entryStyleLabel(scenario.entryStyle)}
                            {scenario.entryAnchor != null
                              ? ` · anchor $${scenario.entryAnchor.toFixed(2)}`
                              : ""}
                            {scenario.entryDistanceAtr != null
                              ? ` · ${scenario.entryDistanceAtr.toFixed(1)}× ATR from anchor`
                              : ""}
                          </p>
                        ) : null}
                        {scenario?.entryQualityTier ? (
                          <p
                            data-testid="entry-quality-tier"
                            style={{
                              margin: "6px 0 0",
                              fontSize: 10.5,
                              lineHeight: 1.5,
                              color:
                                scenario.entryQualityTier === "high"
                                  ? colors.bullish
                                  : scenario.entryQualityTier === "low"
                                    ? colors.caution
                                    : colors.textMuted
                            }}
                          >
                            Entry quality: {entryQualityTierLabel(scenario.entryQualityTier)}
                            {scenario.zoneWidthAtr != null
                              ? ` · band ${scenario.zoneWidthAtr.toFixed(1)}× ATR wide`
                              : ""}
                          </p>
                        ) : null}
                        {scenario?.idealPullbackZone ? (
                          <p
                            data-testid="ideal-pullback-zone"
                            style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.textMuted }}
                          >
                            Ideal pullback zone: {formatIdealPullbackZone(scenario.idealPullbackZone)}
                          </p>
                        ) : null}
                        {entryZoneWarning ? (
                          <div
                            data-testid="entry-zone-rr-warning"
                            style={{
                              marginTop: spacing[3],
                              padding: spacing[3],
                              borderRadius: borderRadius.sm,
                              border: `1px solid ${colors.caution}`,
                              background: `${colors.caution}14`
                            }}
                          >
                            {entryZoneWarning.map((line, idx) => (
                              <p
                                key={line}
                                style={{
                                  margin: idx === 0 ? 0 : "6px 0 0",
                                  fontSize: typography.scale.xs,
                                  lineHeight: 1.5,
                                  color: idx === entryZoneWarning.length - 1 ? colors.caution : colors.text,
                                  fontWeight: idx === entryZoneWarning.length - 1 ? 700 : 500
                                }}
                              >
                                {idx === 0 ? `⚠ ${line}` : line}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {/* Right: R/R gauge */}
                      {scenario ? (
                        <div
                          style={{
                            minWidth: 0,
                            borderLeft: scenarioSideBySide ? `1px solid ${colors.border}` : undefined,
                            borderTop: scenarioSideBySide ? undefined : `1px solid ${colors.border}`,
                            paddingLeft: scenarioSideBySide ? spacing[4] : undefined,
                            paddingTop: scenarioSideBySide ? undefined : spacing[4]
                          }}
                        >
                          <p
                            style={{
                              margin: "0 0 8px",
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: "1.4px",
                              textTransform: "uppercase",
                              color: colors.textMuted
                            }}
                          >
                            Reward / Risk{scenario.chosenLabel ? ` → ${scenario.chosenLabel}` : ""}
                          </p>
                          {currentRr != null ? (
                            <RiskRewardGauge
                              rr={currentRr}
                              minRr={deskMinRr}
                              riskAmount={scenario.riskAmount ?? null}
                              rewardAmount={scenario.rewardAmount ?? null}
                              colors={colors}
                            />
                          ) : (
                            <p
                              data-testid="rr-gate-failed"
                              style={{
                                margin: 0,
                                fontSize: typography.scale.sm,
                                fontWeight: 700,
                                color: colors.caution,
                                lineHeight: 1.45
                              }}
                            >
                              Does not clear desk gate
                            </p>
                          )}
                          {scenario.gateFailReason ? (
                            <p style={{ margin: "6px 0 0", fontSize: typography.scale.xs, color: colors.caution, lineHeight: 1.5 }}>
                              {scenario.gateFailReason}
                            </p>
                          ) : null}
                          {scenario ? (
                            <p style={{ margin: "6px 0 0", fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                              From current ${scenario.currentPrice.toFixed(2)}:
                            </p>
                          ) : null}
                          {scenario?.rrToT1 != null ? (
                            <p
                              style={{
                                margin: "1px 0 0",
                                fontSize: typography.scale.xs,
                                color: scenario.chosenLabel === "T1" ? colors.text : colors.textMuted,
                                fontWeight: scenario.chosenLabel === "T1" ? 700 : 500
                              }}
                            >
                              → T1 ${scenario.target1.toFixed(2)} = {scenario.rrToT1.toFixed(1)}:1
                              {scenario.chosenLabel === "T1" ? " (shown)" : ""}
                            </p>
                          ) : null}
                          {scenario?.rrToT2 != null && scenario.target2 != null ? (
                            <p
                              style={{
                                margin: "1px 0 0",
                                fontSize: typography.scale.xs,
                                color: scenario.chosenLabel === "T2" ? colors.text : colors.textMuted,
                                fontWeight: scenario.chosenLabel === "T2" ? 700 : 500
                              }}
                            >
                              → T2 ${scenario.target2.toFixed(2)} = {scenario.rrToT2.toFixed(1)}:1
                              {scenario.chosenLabel === "T2" ? " (shown)" : ""}
                            </p>
                          ) : null}
                          {scenario?.worstCaseRr != null ? (
                            <p style={{ margin: "4px 0 0", fontSize: typography.scale.xs, color: colors.textMuted }}>
                              If entry zone reached (top of band) → {scenario.chosenLabel}: {scenario.worstCaseRr.toFixed(1)}:1
                            </p>
                          ) : null}
                          {riskReward != null && currentRr != null && Math.abs(riskReward - currentRr) > 0.05 ? (
                            <p style={{ margin: "4px 0 0", fontSize: typography.scale.xs, color: colors.textMuted }}>
                              Eval-time composite R/R: {riskReward.toFixed(1)}:1 (may differ if price moved since evaluation)
                            </p>
                          ) : null}
                          {scenarioRrFixGuidance ? (
                            <ScenarioRrFixPanel guidance={scenarioRrFixGuidance} colors={colors} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {/* Inline what-if planner — nudge entry/stop/target, live R/R (planning only).
                        Gated like the Signals scenario-adjust: Developing+ only, never not_aligned/invalidated. */}
                    {scenario &&
                    setupBias !== "Neutral" &&
                    isExecutionStageEligibleForScenarioAdjust({
                      layersAligned: setupJudgment?.process.layersAligned,
                      layersTotal: setupJudgment?.process.layersTotal
                    }) ? (
                      <ScenarioWhatIf
                        direction={setupBias === "Bearish" ? "bearish" : "bullish"}
                        mode={activeLane}
                        current={scenario.currentPrice}
                        systemStop={scenario.stopPrice}
                        systemTarget={scenario.targetPrice}
                        target1={scenario.target1}
                        target2={scenario.target2}
                        target2Provenance={scenario.target2Provenance}
                        entryZoneLow={scenario.entryLow}
                        entryZoneHigh={scenario.entryHigh}
                        vwap={scenario.vwap}
                        atr={scenario.atr}
                        systemRiskReward={riskReward ?? null}
                        minRrGate={deskMinRr}
                        colors={colors}
                      />
                    ) : null}
                    {/* Copy scenario button */}
                    <button
                      type="button"
                      onClick={() => {
                        const lines = [
                          `${card.symbol} — ${displayDirection.bannerLabel} · ${activeLane === "day" ? "Day desk" : "Swing desk"}`,
                          `Current: $${card.price?.toFixed(2) ?? "—"}`,
                          scenario ? `Stop: $${scenario.stopPrice.toFixed(2)}` : "",
                          scenario
                            ? `Entry zone: $${scenario.entryLow.toFixed(2)} – $${scenario.entryHigh.toFixed(2)}`
                            : "",
                          scenario?.target1 != null
                            ? `T1: $${scenario.target1.toFixed(2)}${scenario.rrToT1 != null ? ` (${scenario.rrToT1.toFixed(1)}:1 from current)` : ""}`
                            : "",
                          scenario?.target2 != null
                            ? `T2: $${scenario.target2.toFixed(2)}${scenario.rrToT2 != null ? ` (${scenario.rrToT2.toFixed(1)}:1 from current)` : ""}`
                            : "",
                          currentRr != null ? `R/R from current: ${currentRr.toFixed(1)}:1 (→ ${scenario?.chosenLabel ?? "target"})` : "",
                          scenario?.worstCaseRr != null ? `Worst-case R/R (zone top → ${scenario?.chosenLabel ?? "target"}): ${scenario.worstCaseRr.toFixed(1)}:1` : ""
                        ]
                          .filter(Boolean)
                          .join("\n");
                        navigator.clipboard.writeText(lines).catch(() => {});
                      }}
                      style={{
                        marginTop: spacing[3],
                        width: "100%",
                        padding: `${spacing[2]} ${spacing[3]}`,
                        background: activeLane === "day" ? colors.accent : "#6366f1",
                        border: "none",
                        borderRadius: borderRadius.sm,
                        color: "#fff",
                        fontSize: typography.scale.sm,
                        fontWeight: 600,
                        cursor: "pointer",
                        letterSpacing: ".3px"
                      }}
                    >
                      Copy scenario
                    </button>
                  </article>
                ) : null}
              </>
            ) : null}
            {allowsScenarioGeometry && isInsufficient ? (
              <div
                data-testid="deep-dive-insufficient"
                style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
              >
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.6 }}>
                  {unavailableMessage}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const sym = card.symbol.trim().toUpperCase();
                    void revalidateSignalCompositeCache(sym, activeLane);
                  }}
                  style={{
                    alignSelf: "flex-start",
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceMuted,
                    color: colors.text,
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    borderRadius: borderRadius.sm,
                    padding: `${spacing[2]} ${spacing[3]}`,
                    cursor: "pointer"
                  }}
                >
                  Retry analysis
                </button>
              </div>
            ) : null}
          </div>
        ) : tab === "layers" && !loading ? (
          <SignalsLayerBreakdown
            symbol={card.symbol}
            tradingMode={activeLane}
            bias={setupBias}
            rows={layerRows}
            loading={loading}
            insufficient={isInsufficient}
            defaultExpanded
            causalNarrative={causalNarrative}
            alignmentRatio={compositeAlignmentRatio}
          />
        ) : tab === "evolution" && !loading ? (
          <SetupEvolutionPanel
            key={`evolution-${card.symbol}-${activeLane}-${dataRefreshNonce}`}
            symbol={card.symbol}
            tradingMode={activeLane}
          />
        ) : tab === "charts" && !loading ? (
          /* Charts tab — full day/swing trading chart */
          <article
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
              {activeLane === "day"
                ? "5-min candles · full session · signal levels overlaid — context only, not entry signals"
                : "Daily candles · 6-month lookback · signal levels overlaid — context only, not entry signals"}
            </p>
            <FullPriceChart
              key={`chart-${card.symbol}-${activeLane}-${dataRefreshNonce}`}
              symbol={card.symbol}
              colors={colors}
              mode={activeLane === "day" ? "day" : "swing"}
              signal={signalOverlay}
              height={320}
              currentPrice={card.price ?? null}
            />
          </article>
        ) : null}
      </div>
      </div>{/* end tabs card */}
    </div>
  );
}
