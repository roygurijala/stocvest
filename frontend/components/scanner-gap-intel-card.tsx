"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties
} from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { GapCatalystNewsDrawer } from "@/components/gap-catalyst-news-drawer";
import { NewsPanel } from "@/components/news-panel";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import { ScannerEmptyStateCard } from "@/components/scanner-empty-state-card";
import { ScannerNearQualificationSection } from "@/components/scanner/scanner-near-qualification-section";
import { ScannerMoverLanes } from "@/components/scanner/scanner-mover-lanes";
import { ScannerWhyMissingPanel } from "@/components/scanner/scanner-why-missing-panel";
import { ScannerQuietLeadersSection } from "@/components/scanner/scanner-quiet-leaders-section";
import { ScannerOutcomeCards } from "@/components/scanner/ScannerOutcomeCards";
import { ScannerQuietDesk } from "@/components/scanner/scanner-quiet-desk";
import { ScannerScanResultHero } from "@/components/scanner/scanner-scan-result-hero";
import { LaggardScanner } from "@/components/scanner/LaggardScanner";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner-client-load";
import { fetchScannerTraceBundleClient } from "@/lib/api/scanner-trace-client";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { buildEvidenceAssistantContext } from "@/lib/assistant/build-evidence-assistant-context";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import type {
  AssistantPageContext,
  AssistantScannerGapSummary,
  AssistantScannerSetupSummary
} from "@/lib/assistant/types";
import type {
  GapIntelligenceItem,
  IntradaySetupPayload,
  ScannerOverview,
  ScannerSetupLoadMode
} from "@/lib/api/scanner";
import { mergeScannerCoreIntoOverview } from "@/lib/scanner-overview-merge";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import { buildScannerProgressHints } from "@/lib/scanner-progress-messaging";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { fetchEarningsCalendarClient } from "@/lib/api/earnings-client";
import type { EarningsEvent } from "@/lib/api/earnings";
import {
  fetchDeskToday,
  type DeskRetainedPoolRow,
  type DeskTodayData,
  type DeskTodayMode
} from "@/lib/api/desk-today";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { GAP_INTEL_ACTIVE_GUIDANCE, GAP_INTEL_EMPTY_CONTEXT } from "@/lib/scanner-quiet-copy";
import { brokersEnabled } from "@/lib/nav-features";
import {
  TAB_LABEL_BOTH,
  TAB_LABEL_DAY,
  TAB_LABEL_SWING
} from "@/lib/mode-terminology";
import {
  buildDayEmptyStateContext,
  buildGapIntelEmptyStateContext,
  buildSwingEmptyStateContext,
  type EmptyStateOverviewInput,
  type ScannerEmptyStateContext
} from "@/lib/scanner-empty-state";
import type { ScenarioInput } from "@/lib/scenario/types";
import { overviewRegimeToVolatilityRegime } from "@/lib/scenario/scenario-input-present";
import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { useSymbolNames } from "@/lib/hooks/use-symbol-names";
import { roleAccents } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useScannerGapIntelBatch } from "@/lib/hooks/use-scanner-gap-intel-batch";
import { fetchSymbolMinuteBars } from "@/lib/fetch-symbol-bars";
import { buildEvidenceFromSetup, enrichEvidenceWithComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  gapIntelligenceHiddenCountForModeDefault,
  gapIntelligenceRowMatchesScannerModeDefault,
  resolveEvidenceTradingMode,
  resolveGapCardTradingMode,
  resolveSetupRowTradingMode
} from "@/lib/scanner-mode-resolution";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
import { scannerSignificanceLabel } from "@/lib/scanner-significance-present";
import {
  CONFIDENCE_PERCENT_TIP,
  GAP_INTELLIGENCE_TIP,
  EVENT_SIGNIFICANCE_SCORE_TIP,
  INTRADAY_SETUPS_TIP,
  SETUP_RELATIVE_VOLUME_TIP
} from "@/lib/ui-tooltips";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { isUsRegularSessionOpenEt, isAfterOrbCloseEt, isoDateInNewYork } from "@/lib/market-hours-et";
import {
  computePmhFromBars,
  entryZoneFromSnapshot,
  formatVolumeShort,
  gapDirectionContext,
  setupExpiryNote,
  setupPatternLabel
} from "@/lib/scanner-display-helpers";
import type { SnapshotPayload } from "@/lib/api/market";
import {
  ScannerOpenSignalsLink,
  SCANNER_MODE_STORAGE_KEY,
  SECONDARY_SHARED_CATALYST_HEADLINE,
  MONO,
  gapItemDisplayCompany,
  CONFLUENCE_BADGE_STYLE,
  isLongDirection,
  formatSignalFiredTimeEt,
  isSecondarySharedCatalyst,
  EMPTY_DESK_REJECTION_SNAPSHOT,
  extractDeskRejectionSnapshot,
  qualityBarStyle,
  gapSyntheticSetup,
  type DeskRejectionSnapshot,
} from "./scanner-page-helpers";

export interface GapIntelCardDeps {
  colors: ThemeColors;
  overview: ScannerOverview;
  scannerSetupMode: ScannerSetupLoadMode;
  dayTradingSurfaces: boolean;
  evidenceLoading: boolean;
  snapBySymbol: Record<string, SnapshotPayload | null>;
  pmhBySymbol: Record<string, number | null>;
  scannerGapIntelBySymbol: ReturnType<typeof useScannerGapIntelBatch>["snapshots"];
  confluenceAlertSymbols: Set<string>;
  earningsBadgeFor: (symbol: string) => { label: string; tip: string } | null;
  openGapNews: (item: GapIntelligenceItem) => void;
  openGapEvidence: (item: GapIntelligenceItem) => Promise<void>;
  goToPortfolioOrder: (params: Record<string, string | undefined>) => void;
}

export interface GapIntelCardProps {
  item: GapIntelligenceItem;
  idx: number;
  noCatSection: boolean;
  deps: GapIntelCardDeps;
}

export function GapIntelCard({ item, idx, noCatSection, deps }: GapIntelCardProps) {
  const {
    colors,
    overview,
    scannerSetupMode,
    dayTradingSurfaces,
    evidenceLoading,
    snapBySymbol,
    pmhBySymbol,
    scannerGapIntelBySymbol,
    confluenceAlertSymbols,
    earningsBadgeFor,
    openGapNews,
    openGapEvidence,
    goToPortfolioOrder
  } = deps;
  const snap = snapBySymbol[item.symbol] ?? null;
  const pmh = pmhBySymbol[item.symbol];
  const giSnap = scannerGapIntelBySymbol[item.symbol.trim().toUpperCase()] ?? null;
  const ctx = gapDirectionContext({ gap_percent: item.gap_pct }, snap);
  const vol = item.volume || 0;
  const qStyle = qualityBarStyle(item.gap_quality_score, colors);
  const sent = (item.catalyst?.sentiment || "").toLowerCase();
  const sentBg =
    sent === "bullish"
      ? "rgba(34,197,94,.15)"
      : sent === "bearish"
        ? "rgba(239,68,68,.15)"
        : "rgba(245,158,11,.18)";
  const sentFg = sent === "bullish" ? colors.bullish : sent === "bearish" ? colors.bearish : colors.caution;
  return (
    <motion.article
      key={`${item.symbol}-${noCatSection ? "nc" : "c"}-${idx}`}
      className={surfaceGlowClassName}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05 }}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[3],
        borderLeft: noCatSection ? `4px solid ${colors.caution}` : undefined
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: spacing[2],
            flexWrap: "wrap",
            width: "100%",
            minWidth: 0
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "15px", color: colors.text }}>{item.symbol}</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[1], flexShrink: 0, marginLeft: "auto" }}>
            {(() => {
              const b = earningsBadgeFor(item.symbol);
              if (!b) return null;
              return (
                <span
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "2px 8px",
                    background: "rgba(245,158,11,.18)",
                    color: colors.caution,
                    fontSize: typography.scale.xs,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  {b.label}
                  <InfoTip text={b.tip} label="Earnings risk" />
                </span>
              );
            })()}
            <span
              style={{
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                fontSize: typography.scale.xs,
                fontFamily: MONO,
                fontWeight: 700,
                ...(item.gap_pct > 0
                  ? { background: "rgba(34,197,94,0.18)", color: colors.bullish }
                  : item.gap_pct < 0
                    ? { background: "rgba(239,68,68,0.18)", color: colors.bearish }
                    : { background: colors.surfaceMuted, color: colors.textMuted })
              }}
            >
              {item.gap_pct > 0 ? "+" : ""}
              {item.gap_pct.toFixed(2)}%
            </span>
            {confluenceAlertSymbols.has(item.symbol.trim().toUpperCase()) ? (
              <span style={CONFLUENCE_BADGE_STYLE}>CONFLUENCE</span>
            ) : null}
          </div>
        </div>
        {gapItemDisplayCompany(item) ? (
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{gapItemDisplayCompany(item)}</span>
        ) : null}
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Pre-market gap</span>
      </div>
        <div style={{ marginTop: spacing[2] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Event significance</span>
            <InfoTip text={EVENT_SIGNIFICANCE_SCORE_TIP} label="What event significance measures" maxWidth={280} />
          </div>
          <span
            style={{ fontSize: typography.scale.xs, fontFamily: MONO }}
            title={`Model event significance ${item.gap_quality_score}/100`}
            data-testid={`scanner-event-significance-${item.symbol.trim().toUpperCase()}`}
          >
            {scannerSignificanceLabel(item.gap_quality_score)}
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            height: 8,
            background: colors.surfaceMuted,
            borderRadius: borderRadius.full,
            overflow: "hidden"
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, item.gap_quality_score)}%`,
              borderRadius: borderRadius.full,
              background: qStyle.fill,
              boxShadow: qStyle.glow,
              minWidth: "8%"
            }}
          />
        </div>
        <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
          Vol: {formatVolumeShort(vol)} ({item.volume_vs_avg.toFixed(1)}x avg) · Price: ${item.current_price.toFixed(2)}
        </p>
      </div>
      {typeof pmh === "number" && Number.isFinite(pmh) ? (
        <p style={{ margin: `${spacing[1]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
          PMH: ${pmh.toFixed(2)}
        </p>
      ) : null}
      {ctx ? (
        <p style={{ margin: `${spacing[1]} 0 0`, color: colors.text, fontSize: typography.scale.xs }}>{ctx}</p>
      ) : null}
      {giSnap ? (
        <p
          data-testid={`scanner-gap-intel-lifecycle-${item.symbol.trim().toUpperCase()}`}
          style={{
            margin: `${spacing[1]} 0 0`,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            fontFamily: MONO,
            lineHeight: 1.4
          }}
        >
          Gap lifecycle: {giSnap.phase.label} · Scenario builder {giSnap.scenario_builder.state}
          {giSnap.flags.stale ? " · data may be stale" : ""}
        </p>
      ) : null}
      {item.has_catalyst && item.catalyst ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open news article"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openGapNews(item);
            }
          }}
          onClick={() => openGapNews(item)}
          style={{
            marginTop: spacing[2],
            cursor: "pointer",
            borderRadius: borderRadius.md,
            padding: spacing[1],
            marginLeft: `-${spacing[1]}`,
            marginRight: `-${spacing[1]}`,
            outline: "none",
            border: `1px solid transparent`
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.background = colors.surfaceMuted;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <p style={{ margin: 0, fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>WITH CATALYST</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[1] }}>
            <span
              style={{
                background: "rgba(59,130,246,0.12)",
                color: colors.accent,
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                fontSize: typography.scale.xs
              }}
            >
              {item.catalyst.category}
            </span>
            <span
              style={{
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                fontSize: typography.scale.xs,
                fontWeight: 600,
                background: sentBg,
                color: sentFg
              }}
            >
              {item.catalyst.sentiment}
            </span>
          </div>
          <p
            style={{
              margin: `${spacing[2]} 0 0`,
              fontSize: typography.scale.sm,
              color: colors.text,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {item.catalyst.headline}
          </p>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: 10, color: colors.textMuted }}>Tap to read full article</p>
        </div>
      ) : (
        <div style={{ marginTop: spacing[2] }}>
          <div style={{ display: "flex", gap: spacing[2], alignItems: "flex-start" }}>
            <span
              aria-hidden
              style={{
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderBottom: `10px solid ${colors.caution}`,
                marginTop: 3,
                flexShrink: 0
              }}
            />
            <div>
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution, fontWeight: 600 }}>
                No catalyst found — momentum gap only
              </p>
              <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                Price-only gaps carry higher reversal risk
              </p>
            </div>
          </div>
        </div>
      )}
      {/* B30 Phase 4: "Best evaluated as" classifier tag. Advisory — shows
          which engine the View Signal click will route to in the 'both'
          scanner view, and which engine is best-fit for swing/day views.
          Hidden when the verdict is unavailable (e.g. cached pre-Phase-4
          response) since we can't justify a guess. */}
      {item.mode_best_fit ? (() => {
        const verdictMode = resolveGapCardTradingMode(scannerSetupMode, item.mode_best_fit);
        const isExplicitContext = scannerSetupMode === "swing" || scannerSetupMode === "day";
        const verdict = item.mode_best_fit;
        // Pill copy: short and unambiguous.
        const label =
          verdict === "swing"
            ? "Best evaluated as: Swing (multi-day)"
            : verdict === "day"
              ? "Best evaluated as: Day (intraday)"
              : "Best evaluated as: Either desk";
        // Color tokens follow the design system role contract:
        //   swing → accent (cool/structural), day → caution (warm/active),
        //   either → textMuted (neutral). Background is a subtle tint of
        //   the role color so the pill reads as an annotation, not a CTA.
        const pillFg =
          verdict === "swing" ? colors.accent : verdict === "day" ? colors.caution : colors.textMuted;
        const pillBg =
          verdict === "swing"
            ? "rgba(59,130,246,0.10)"
            : verdict === "day"
              ? "rgba(245,158,11,0.12)"
              : "rgba(148,163,184,0.10)";
        const tipText = isExplicitContext
          ? `You're in ${scannerSetupMode === "swing" ? "Swing" : "Day"} scanner mode, so the View Signal click opens the ${scannerSetupMode === "swing" ? "Swing" : "Day"} engine regardless of this verdict. The tag indicates the classifier's best-fit assessment for this gap.`
          : verdictMode === verdict
            ? "View Signal opens this engine."
            : "View Signal opens the Swing engine by default. Switch the scanner to Day mode to open the Day engine on this gap.";
        return (
          <div style={{ marginTop: spacing[2], display: "flex", flexDirection: "column", gap: spacing[1] }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[1], flexWrap: "wrap" }}>
              <span
                data-testid="gap-mode-best-fit"
                data-mode-best-fit={verdict}
                style={{
                  borderRadius: borderRadius.full,
                  padding: "2px 10px",
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  background: pillBg,
                  color: pillFg,
                  border: `1px solid ${pillFg}`,
                  letterSpacing: "0.02em"
                }}
              >
                {label}
              </span>
              <InfoTip text={tipText} label="Best evaluated as — why this verdict" maxWidth={320} />
            </div>
            {item.mode_best_fit_reasons && item.mode_best_fit_reasons.length > 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  lineHeight: 1.35
                }}
              >
                {item.mode_best_fit_reasons.join(" \u00b7 ")}
              </p>
            ) : null}
          </div>
        );
      })() : null}
      <div style={{ marginTop: spacing[2], display: "inline-flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void openGapEvidence(item)}
          disabled={evidenceLoading}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surfaceMuted,
            color: colors.text,
            padding: `${spacing[1]} ${spacing[2]}`,
            cursor: evidenceLoading ? "wait" : "pointer",
            opacity: evidenceLoading ? 0.72 : 1,
            fontSize: typography.scale.xs,
            fontWeight: 500
          }}
        >
          {evidenceLoading ? "Preparing signal..." : "View Signal"}
        </button>
        <AddToWatchlistButton symbol={item.symbol} dualDeskTracking={dayTradingSurfaces} />
        {(() => {
          // Build the Scenario Builder input from the gap card's
          // structural fields. The eligibility helper decides whether
          // the button renders enabled or disabled-with-tooltip; we
          // don't pre-judge here.
          const sym = item.symbol.trim().toUpperCase();
          const gapDirection: ScenarioInput["direction"] =
            item.gap_pct > 0 ? "bullish" : item.gap_pct < 0 ? "bearish" : "neutral";
          const scenarioInput: ScenarioInput = {
            symbol: sym,
            direction: gapDirection,
            mode: "day",
            generated_at: new Date().toISOString(),
            reference: {
              current_price: item.current_price,
              prev_close: item.prev_close
            },
            volatility_regime: overviewRegimeToVolatilityRegime(overview.regimeLabel),
            tags: [
              `Gap ${item.gap_pct >= 0 ? "+" : ""}${item.gap_pct.toFixed(2)}%`,
              item.has_catalyst ? "With catalyst" : "Momentum-only"
            ]
          };
          return (
            <ScenarioBuilderInline
              input={scenarioInput}
              readiness={{
                symbol: sym,
                mode: "day",
                setupBias:
                  gapDirection === "bullish" ? "Bullish" : gapDirection === "bearish" ? "Bearish" : "Neutral",
                hasReferenceLevels: item.current_price != null
              }}
              drillDown={{ surface: "scanner" }}
              testId={`build-scenario-gap-${sym}`}
            />
          );
        })()}
        {brokersEnabled() ? (
          <span title="ORB window has closed for today" style={{ display: "inline-flex" }}>
            <button
              type="button"
              onClick={() => {
                const sym = item.symbol.trim().toUpperCase();
                const setupFor = overview.setups.find((s) => s.symbol.trim().toUpperCase() === sym);
                goToPortfolioOrder({
                  symbol: sym,
                  side: item.gap_pct >= 0 ? "buy" : "sell",
                  pattern: "pre_market_gap",
                  signal_strength: String(Math.min(100, Math.max(0, Math.round(item.gap_quality_score)))),
                  signal_direction: item.gap_pct >= 0 ? "bullish" : "bearish",
                  ...(setupFor?.confluence_score != null
                    ? { confluence_score: String(Math.round(setupFor.confluence_score)) }
                    : {})
                });
              }}
              style={{
                border: `1px solid ${colors.accent}`,
                borderRadius: borderRadius.md,
                background: "rgba(59,130,246,0.22)",
                color: colors.accent,
                padding: `${spacing[2]} ${spacing[3]}`,
                cursor: "pointer",
                fontSize: typography.scale.sm,
                fontWeight: 700,
                letterSpacing: "0.02em",
                boxShadow: "0 0 14px rgba(59,130,246,0.18)"
              }}
            >
              Open order entry
            </button>
          </span>
        ) : null}
      </div>
      <p
        style={{
          margin: `${spacing[2]} 0 0`,
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          lineHeight: 1.45,
          maxWidth: "100%"
        }}
      >
        Use Watchlist to track for post-gap base or mean-reversion.
      </p>
      <p
        style={{
          margin: `${spacing[2]} 0 0`,
          fontSize: 10,
          color: colors.textMuted,
          letterSpacing: 0.02,
          textTransform: "uppercase"
        }}
      >
        Not investment advice
      </p>
    </motion.article>
  );
}
