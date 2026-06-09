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
import { parseSwingCompositeInsight, parseCompositeAlignment, parseFundamentalContext } from "@/lib/signal-evidence";
import type { SignalEvidenceInsight } from "@/lib/signal-evidence/wire-types";
import {
  compositeToSignalsLayerRows,
  deriveSetupBiasFromComposite
} from "@/lib/signals/composite-layer-rows";
import {
  buildSignalsPageDecision,
  pickPreviewLayers,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { resolveCausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import { resolveTimeframeContext, isTimeframeCounterTrend } from "@/lib/signal-evidence/timeframe-context";
import { resolveSetupJudgmentFromComposite } from "@/lib/signal-evidence/setup-judgment";
import { coerceSnapshotForReferenceLevels, deriveSessionReferenceLevels } from "@/lib/snapshot-reference-levels";
import { buildFundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
// Reuse the exact same signals-page components so Setup/Layers are identical.
import { SignalsBiasRationalePanel } from "@/components/signals/signals-bias-rationale-panel";
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import { SignalsLayerBreakdown } from "@/components/signals/signals-layer-breakdown";
import { CausalNarrativePanel } from "@/components/signals/causal-narrative-panel";
import { MarketContextPanel } from "@/components/signals/market-context-panel";
import { TimeframeContextPanel } from "@/components/signals/timeframe-context-panel";
import { SetupEvolutionPanel } from "@/components/signals/setup-evolution-panel";
import { FullPriceChart, type ChartSignalOverlay } from "@/components/assistant/full-price-chart";
import { ScenarioWhatIf } from "@/components/dashboard/trading-room/scenario-what-if";
import { RiskStackPanel } from "@/components/signal-evidence/risk-stack-panel";
import { isExecutionStageEligibleForScenarioAdjust } from "@/lib/scenario/scenario-variants";
import type { FeedBias, FeedCard, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import { parseLedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import { minRrForDeskMode, parseMarketEnvironment } from "@/lib/signal-evidence/market-environment-present";
import {
  parseMarketContextDampening,
  parseMarketContextFlags
} from "@/lib/signal-evidence/market-context-present";
import { parseApiDecisionState } from "@/lib/signal-evidence/risk-stack-present";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";

type Colors = ReturnType<typeof useTheme>["colors"];
type DeepDiveTab = "setup" | "layers" | "evolution" | "charts";

const STATE_LABEL: Record<FeedState, string> = {
  actionable: "Actionable",
  near: "Near",
  potential: "Potential",
  cooling: "Cooling"
};


function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
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
 * Comprehensive plain-English brief that summarises every key data-point on
 * the page so the user gets the full picture before scrolling into the tabs.
 */
function buildRichBrief(
  card: FeedCard,
  insight: SignalEvidenceInsight | null,
  layerRows: SignalsLayerRowInput[],
  pageDecisionState: string | null,
  pageDecisionLine: string | null,
  causalSummary: string | null,
  causalChainLabel: string | null,
  setupJudgment: { process: { layersAligned: number; layersTotal: number }; tradeability: { label: string; flags: { label: string }[] }; primaryBlocker: string | null; watchFor: string | null } | null,
  riskReward: number | null,
  activeLane: "day" | "swing",
  deskMinRr: number
): string {
  const dir = card.bias === "bull" ? "long" : card.bias === "bear" ? "short" : "two-sided";
  const desk = activeLane === "day" ? "day desk" : "swing desk";

  // S1 — direction + desk + broad trend read
  let s1: string;
  if (insight) {
    const trend = `${insight.trend_strength.toLowerCase()} ${insight.trend_direction.toLowerCase()}`.trim();
    const conf = insight.confirming_signals.length;
    const confl = insight.conflicting_signals.length;
    s1 = `${card.symbol} is showing a ${dir} setup on the ${desk} — ${trend} read${conf ? `, with ${conf} signal${conf === 1 ? "" : "s"} confirming` : ""}${confl ? ` and ${confl} pushing back` : ""}.`;
  } else {
    s1 = `${card.symbol} is setting up ${dir} on the ${desk}.`;
  }

  // S2 — layer alignment detail
  let s2 = "";
  if (setupJudgment) {
    const { layersAligned, layersTotal } = setupJudgment.process;
    const aligned = layerRows
      .filter((r) => (card.bias === "bull" ? r.status === "Bullish" : card.bias === "bear" ? r.status === "Bearish" : false))
      .slice(0, 4)
      .map((r) => r.name);
    const neutral = layerRows.filter((r) => r.status === "Neutral").slice(0, 2).map((r) => r.name);
    if (aligned.length > 0) {
      s2 = `${layersAligned} of ${layersTotal} layers aligned: ${aligned.join(", ")} are all confirming${neutral.length > 0 ? `; ${neutral.join(", ")} read neutral` : ""}.`;
    } else {
      s2 = `${layersAligned} of ${layersTotal} layers currently carry a directional read.`;
    }
  }

  // S3 — causal chain (why layers lean this way)
  const s3 = causalSummary?.trim() ?? "";

  // S4 — causal chain label if distinct and short
  const s4 = causalChainLabel && causalChainLabel.length < 80 ? `Tailwind chain: ${causalChainLabel}.` : "";

  // S5 — entry timing + primary blocker
  let s5 = "";
  if (setupJudgment) {
    const timing = setupJudgment.tradeability.label;
    const blocker = setupJudgment.primaryBlocker;
    if (pageDecisionState === "actionable" && !blocker) {
      s5 = `${timing} — all gates cleared for this trade.`;
    } else if (blocker) {
      s5 = `${timing}. Primary check: ${blocker}`;
    } else {
      s5 = `${timing}.`;
    }
  }

  // S6 — R/R + what-to-watch
  let s6 = "";
  if (riskReward != null && riskReward > 0) {
    const gateLabel = `${deskMinRr.toFixed(1)}:1`;
    const rrStr = riskReward >= deskMinRr
      ? `Risk/reward is ${riskReward.toFixed(1)}:1, clearing the ${gateLabel} gate`
      : `Risk/reward is ${riskReward.toFixed(1)}:1 — below the ${gateLabel} threshold`;
    const watch = setupJudgment?.watchFor;
    s6 = watch ? `${rrStr}. ${watch}` : `${rrStr}.`;
  } else if (setupJudgment?.watchFor) {
    s6 = setupJudgment.watchFor;
  }

  // Fallback if composite hasn't loaded yet
  if (!s2 && !s3 && !s5) return card.verdict || s1;

  return [s1, s2, s3, s4, s5, s6].filter(Boolean).join(" ");
}

/**
 * Single-line scenario geometry: a horizontal Stop → Target track with a
 * proportionally-placed entry-zone band + current-price marker, and a clean
 * evenly-spaced label row below so the values never overlap regardless of how
 * close the price levels are.
 */
function ScenarioGeometry({
  currentPrice,
  stopPrice,
  targetPrice,
  target1,
  target2,
  entryLow,
  entryHigh,
  colors
}: {
  currentPrice: number;
  stopPrice: number;
  targetPrice: number;
  target1?: number | null;
  target2?: number | null;
  entryLow: number;
  entryHigh: number;
  colors: Colors;
}) {
  // The track spans Stop(0%) → the furthest target(100%) so both T1 and T2 fit.
  const trackHigh = Math.max(targetPrice, target1 ?? targetPrice, target2 ?? targetPrice);
  const span = trackHigh - stopPrice;
  const pct = (p: number) => (span > 0 ? Math.max(0, Math.min(100, ((p - stopPrice) / span) * 100)) : 50);
  const entryLowPct = pct(entryLow);
  const entryHighPct = pct(entryHigh);
  const currentPct = pct(currentPrice);
  // Only show T1 as a distinct interior tick when it differs from the headline target.
  const showT1 = target1 != null && Math.abs(target1 - targetPrice) > 0.01 && target1 < trackHigh - 0.01;
  const t1Pct = showT1 ? pct(target1 as number) : null;
  // Keep the floating current-price label fully on-screen near the edges.
  const currentLabelPct = Math.min(92, Math.max(8, currentPct));
  const inZone = currentPrice >= entryLow && currentPrice <= entryHigh;

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
      {/* Horizontal track: red (loss side, near stop) → green (profit side, near target) */}
      <div
        style={{
          position: "relative",
          height: 10,
          marginTop: 20,
          borderRadius: 999,
          background: "linear-gradient(90deg, rgba(239,68,68,.45) 0%, rgba(148,163,184,.22) 50%, rgba(34,197,94,.45) 100%)"
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
        {/* T1 tick (only when the headline target is T2, so T1 sits inside the track) */}
        {t1Pct != null ? (
          <div
            style={{
              position: "absolute",
              left: `${t1Pct}%`,
              top: -3,
              bottom: -3,
              transform: "translateX(-50%)",
              width: 2,
              background: colors.bullish,
              opacity: 0.7,
              borderRadius: 2
            }}
            title={`T1 $${(target1 as number).toFixed(2)}`}
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

      {/* Stop / Target anchored to the actual track ends */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.textMuted }}>
            Stop
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: colors.bearish }}>
            ${stopPrice.toFixed(2)}
          </span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: "right" }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.textMuted }}>
            {showT1 ? "Target T2" : "Target"}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: colors.bullish }}>
            ${targetPrice.toFixed(2)}
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
        {showT1
          ? legendItem(
              <span style={{ width: 3, height: 12, borderRadius: 2, background: colors.bullish, opacity: 0.7 }} />,
              "T1",
              `$${(target1 as number).toFixed(2)}`,
              colors.bullish
            )
          : null}
      </div>

      {/* One-line explanation of the gradient */}
      <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.5, color: colors.textMuted }}>
        Bar runs stop → target: <span style={{ color: colors.bearish, fontWeight: 700 }}>red</span> is the loss side
        (toward your stop), <span style={{ color: colors.bullish, fontWeight: 700 }}>green</span> is the profit side
        (toward your target).
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
  onBackToBrief,
  isMobile = false,
  colors
}: {
  card: FeedCard;
  /** Full feed list — used to know the other lane's state for the toggle. */
  allCards?: FeedCard[];
  /** Fallback map for company names not yet set on the card. */
  companyBySymbol?: Map<string, string>;
  onBackToBrief: () => void;
  isMobile?: boolean;
  colors: Colors;
}) {
  const [tab, setTab] = useState<DeepDiveTab>("setup");
  // activeLane allows switching Day/Swing within the deep dive
  const [activeLane, setActiveLane] = useState<"day" | "swing">(card.lane);

  // Company name: use card data first, then companyBySymbol map, then fetch
  // from the tickers-search endpoint as a last resort (covers desk-only cards
  // where neither the scanner overview nor the snapshot carry a name).
  const [resolvedCompany, setResolvedCompany] = useState<string | null>(
    card.company ?? companyBySymbol?.get(card.symbol) ?? null
  );
  useEffect(() => {
    const known = card.company ?? companyBySymbol?.get(card.symbol) ?? null;
    if (known) {
      setResolvedCompany(known);
      return;
    }
    setResolvedCompany(null);
    let cancelled = false;
    fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(card.symbol)}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        const items: { symbol: string; name: string }[] = Array.isArray(
          (data as Record<string, unknown>)?.items
        )
          ? (data as { items: { symbol: string; name: string }[] }).items
          : [];
        const match = items.find((i) => i.symbol === card.symbol);
        if (match?.name) setResolvedCompany(match.name);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [card.symbol, card.company, companyBySymbol]);

  // Derive per-lane state for the toggle — null means no card in the feed.
  const dayLaneCard = allCards.find((c) => c.symbol === card.symbol && c.lane === "day") ?? null;
  const swingLaneCard = allCards.find((c) => c.symbol === card.symbol && c.lane === "swing") ?? null;
  // If we're viewing a card that's in the feed but the feed list wasn't passed,
  // fall back to the card itself so its own lane is never shown as unavailable.
  const dayState: FeedState | null = dayLaneCard?.state ?? (card.lane === "day" ? card.state : null);
  const swingState: FeedState | null = swingLaneCard?.state ?? (card.lane === "swing" ? card.state : null);
  const { composite, isInitialLoading } = useSignalComposite(card.symbol, activeLane);

  // ── Full signals-page computation pipeline ─────────────────────────────────
  const insight = useMemo(() => (composite ? parseSwingCompositeInsight(composite) : null), [composite]);
  const layerRows = useMemo(() => compositeToSignalsLayerRows(composite), [composite]);
  const setupBias: SignalsSetupBias = useMemo(
    () => deriveSetupBiasFromComposite(composite, layerRows),
    [composite, layerRows]
  );
  const isInsufficient = !composite || isInsufficientCompositeResponse(composite);

  const compositeAlignmentRatio = useMemo(() => {
    if (isInsufficient) return null;
    const ar = (composite as Record<string, unknown>).alignment_ratio;
    return typeof ar === "number" && Number.isFinite(ar) ? ar : null;
  }, [composite, isInsufficient]);

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
    const rr = typeof c.risk_reward === "number" && Number.isFinite(c.risk_reward) ? c.risk_reward : 1.5;
    const rrWarning = Boolean(c.rr_warning) || (Number.isFinite(rr) && rr < deskMinRr);
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

  // R/R ratio from composite payload
  const riskReward = useMemo(() => {
    if (isInsufficient) return null;
    const c = composite as Record<string, unknown>;
    const rr = typeof c.risk_reward === "number" && Number.isFinite(c.risk_reward) ? c.risk_reward : null;
    return rr;
  }, [composite, isInsufficient]);

  // Single source of truth for the scenario panel: stop / entry zone / target,
  // the current-price marker, and the dollar risk/reward. Prefers the engine's
  // real reference levels (reference_stop_level, reference_target_1/2,
  // historical_entry_zone) so the geometry, the dollar amounts, AND the R/R
  // gauge ratio all reconcile. Mirrors the backend R/R math exactly: entry is
  // the current price (`last`), R/R = reward/risk, preferring T1 unless T1 is
  // sub-1:1 and T2 improves it (see risk_reward_structure.py). Falls back to
  // session-derived support/resistance only when the engine omits a level.
  const scenario = useMemo(() => {
    const price = card.price;
    if (price == null || !Number.isFinite(price)) return null;
    const isLong = card.bias !== "bear";
    const stopPrice =
      signalOverlay?.stop ??
      (referenceLevels.support != null ? referenceLevels.support * 0.997 : price * (isLong ? 0.97 : 1.03));
    const t1 = signalOverlay?.target1 ?? referenceLevels.resistance ?? price * (isLong ? 1.025 : 0.975);
    const t2 = signalOverlay?.target2 ?? null;
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
    let chosen = rrT1;
    let chosenLabel: "T1" | "T2" = "T1";
    if (rrT2) {
      if (!chosen) {
        chosen = rrT2;
        chosenLabel = "T2";
      } else if (chosen.ratio < 1 && rrT2.ratio > chosen.ratio) {
        chosen = rrT2;
        chosenLabel = "T2";
      }
    }
    const targetPrice = chosen?.target ?? t1;
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
      atr
    };
  }, [card.price, card.bias, signalOverlay, referenceLevels, composite, isInsufficient]);

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

  const brief = useMemo(
    () =>
      buildRichBrief(
        card,
        insight,
        layerRows,
        pageDecision?.state ?? null,
        pageDecision?.line ?? null,
        causalNarrative?.summary ?? null,
        causalNarrative?.chainLabel ?? null,
        setupJudgment,
        riskReward,
        activeLane,
        deskMinRr
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, insight, layerRows, pageDecision?.state, pageDecision?.line, causalNarrative?.summary, causalNarrative?.chainLabel, setupJudgment, riskReward, activeLane, deskMinRr]
  );

  const sTone = stateTone(card.state, colors);
  const pct = card.changePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  const laneAccent = activeLane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const directionColor = card.bias === "bull" ? colors.bullish : card.bias === "bear" ? colors.bearish : colors.textMuted;
  const loading = isInitialLoading && !composite;

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

  // Brief meta-line: "X of Y layers confirmed · Macro [status] · N timing caution(s)"
  const briefMeta = useMemo(() => {
    if (!setupJudgment) return null;
    const { layersAligned, layersTotal } = setupJudgment.process;
    const layersPart = `${layersAligned} of ${layersTotal} layers confirmed`;
    const macroRow = layerRows.find((r) => r.key === "macro");
    const macroPart = macroRow ? `Macro ${macroRow.status?.toLowerCase() ?? "n/a"}` : null;
    const flags = setupJudgment.tradeability.flags.length;
    const flagsPart = flags > 0 ? `${flags} timing caution${flags === 1 ? "" : "s"}` : null;
    return [layersPart, macroPart, flagsPart].filter(Boolean).join(" · ");
  }, [setupJudgment, layerRows]);

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
              {card.bias === "bull" ? "LONG" : card.bias === "bear" ? "SHORT" : "NEUTRAL"}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>·</span>
            <span style={{ fontSize: typography.scale.xl, fontWeight: 800, letterSpacing: "0.02em", color: colors.text }}>
              {card.symbol}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>·</span>
            <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: sTone, letterSpacing: "0.02em" }}>
              {STATE_LABEL[card.state]}
            </span>
          </div>
          <LaneToggle
            activeLane={activeLane}
            onChange={setActiveLane}
            dayState={dayState}
            swingState={swingState}
            symbol={card.symbol}
            colors={colors}
          />
          <span
            style={{
              justifySelf: isMobile ? undefined : "end",
              marginLeft: isMobile ? "auto" : undefined,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              color: colors.bullish,
              border: `1px solid ${colors.bullish}`,
              borderRadius: borderRadius.full,
              padding: "3px 12px",
              background: `${colors.bullish}18`,
              whiteSpace: "nowrap"
            }}
          >
            ✓ Watching
          </span>
        </div>

        {/* Row 2: Company · Price ±%  |  Evaluated timestamp */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: spacing[2] }}>
            {resolvedCompany ? (
              <>
                <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, fontWeight: 500 }}>
                  {resolvedCompany}
                </span>
                <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>·</span>
              </>
            ) : null}
            <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
              {fmtPrice(card.price)}
            </span>
            {pct != null ? (
              <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone }}>
                {fmtPct(pct)}
              </span>
            ) : null}
          </div>
          {evalTime ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, whiteSpace: "nowrap" }}>
              Evaluated {evalTime}
            </span>
          ) : null}
        </div>
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
            {brief}
          </p>
        </div>
        {/* meta-line + "View full analysis →" */}
        {briefMeta || true ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: spacing[3],
              paddingTop: spacing[2],
              borderTop: `1px solid ${colors.border}`,
              gap: spacing[3],
              flexWrap: "wrap"
            }}
          >
            {briefMeta ? (
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{briefMeta}</span>
            ) : (
              <span />
            )}
            <a
              href={`/signals?symbol=${encodeURIComponent(card.symbol)}&mode=${activeLane}`}
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 700,
                color: colors.accent,
                textDecoration: "none",
                whiteSpace: "nowrap"
              }}
            >
              View full analysis →
            </a>
          </div>
        ) : null}
      </div>

      {marketEnvironment && apiDecisionState ? (
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
      <div style={{ minHeight: 120 }}>
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
        {tab === "setup" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            {loading ? (
              <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
                Loading live analysis…
              </span>
            ) : null}
            {!loading && !isInsufficient ? (
              <>
                {/* 1. Bias + layer force summary (prototype panel 1) */}
                <SignalsBiasRationalePanel
                  bias={setupBias}
                  rows={layerRows}
                  signalSummary={layerSignalSummary}
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
                  />
                ) : null}
                {/* 6. Scenario geometry + R/R gauge side-by-side + Copy scenario */}
                {card.price != null ? (
                  <article
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      padding: `${spacing[3]} ${spacing[4]}`
                    }}
                  >
                    {/* One row: Scenario geometry (left) | R/R gauge (right) */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: riskReward != null ? "1fr auto" : "1fr",
                        gap: spacing[4],
                        alignItems: "start"
                      }}
                    >
                      {/* Left: Scenario geometry */}
                      <div>
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
                        {scenario ? (
                          <ScenarioGeometry
                            currentPrice={scenario.currentPrice}
                            stopPrice={scenario.stopPrice}
                            targetPrice={scenario.targetPrice}
                            target1={scenario.target1}
                            target2={scenario.target2}
                            entryLow={scenario.entryLow}
                            entryHigh={scenario.entryHigh}
                            colors={colors}
                          />
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
                      </div>
                      {/* Right: R/R gauge */}
                      {riskReward != null ? (
                        <div
                          style={{
                            borderLeft: `1px solid ${colors.border}`,
                            paddingLeft: spacing[4]
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
                            Reward / Risk{scenario?.chosenLabel ? ` → ${scenario.chosenLabel}` : ""}
                          </p>
                          <RiskRewardGauge
                            rr={riskReward}
                            minRr={deskMinRr}
                            riskAmount={scenario?.riskAmount ?? null}
                            rewardAmount={scenario?.rewardAmount ?? null}
                            colors={colors}
                          />
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
                              Worst case (top of entry zone) → {scenario.chosenLabel}: {scenario.worstCaseRr.toFixed(1)}:1
                            </p>
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
                          `${card.symbol} — ${card.bias === "bull" ? "LONG" : card.bias === "bear" ? "SHORT" : "—"} · ${activeLane === "day" ? "Day desk" : "Swing desk"}`,
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
                          riskReward != null ? `R/R shown: ${riskReward.toFixed(1)}:1 (current → ${scenario?.chosenLabel ?? "target"})` : "",
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
            {!loading && isInsufficient ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.6 }}>
                {card.verdict}
              </p>
            ) : null}
          </div>
        ) : tab === "layers" ? (
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
        ) : tab === "evolution" ? (
          <SetupEvolutionPanel symbol={card.symbol} tradingMode={activeLane} />
        ) : (
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
              symbol={card.symbol}
              colors={colors}
              mode={activeLane === "day" ? "day" : "swing"}
              signal={signalOverlay}
              height={320}
              currentPrice={card.price ?? null}
            />
          </article>
        )}
      </div>
      </div>{/* end tabs card */}
    </div>
  );
}
