"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardOpportunityListSection } from "@/components/dashboard/dashboard-opportunity-list-section";
import Link from "next/link";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { DeskRefreshButton } from "@/components/dashboard/desk-refresh-button";
import { DashboardOpportunityRowList } from "@/components/dashboard/dashboard-opportunity-row";
import { ScannerWhyMissingPanel } from "@/components/scanner/scanner-why-missing-panel";
import type { MarketStatusPayload } from "@/lib/api/market";
import { DashboardMissedTodayStrip } from "@/components/dashboard/dashboard-missed-today-strip";
import {
  deskScanFootnote,
  formatGeneratedAtEt,
  resolveDiscoveryLeaders
} from "@/lib/dashboard/desk-today-present";
import {
  diffDeskSinceLastVisit,
  loadDeskLastVisit,
  saveDeskLastVisit,
  sinceLastVisitSummary
} from "@/lib/dashboard/desk-since-last-visit";
import {
  hotInMarketAwaitingMessage,
  hotInMarketEmptyMessage,
  hotInMarketFeedSubtitle,
  MARKET_ACTIVITY_TITLE
} from "@/lib/dashboard/hot-in-market-card-present";
import {
  isDeskSessionActivityStale,
  sessionActivityAwaitingTodayMessage
} from "@/lib/dashboard/desk-session-freshness";
import { buildSessionActivityRowModels } from "@/lib/dashboard/opportunity-row-present";
import {
  resolveSessionActivityUiMode,
  sessionActivityClosedSummary,
  sessionActivitySubtitleSuffix
} from "@/lib/market/session-activity-mode";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  deskSource?: string | null;
  alternateDeskData?: DeskTodayData | null | undefined;
  gapFallback: GapIntelligenceItem[];
  isLoading?: boolean;
  sessionActivityLoading?: boolean;
  scannerPending?: boolean;
  dualDeskSurfaces?: boolean;
  onRefreshDesk?: () => void;
  refreshBusy?: boolean;
  canRefreshDesk?: boolean;
  refreshCooldownLabel?: string | null;
  refreshError?: string | null;
  marketStatus?: MarketStatusPayload | null;
  variant?: "standalone" | "pipeline";
};

export function DashboardDiscoveryFeed({
  mode,
  deskData,
  deskSource = null,
  alternateDeskData,
  gapFallback,
  isLoading = false,
  sessionActivityLoading = false,
  scannerPending = false,
  dualDeskSurfaces = true,
  onRefreshDesk,
  refreshBusy = false,
  canRefreshDesk = false,
  refreshCooldownLabel = null,
  refreshError = null,
  marketStatus = null,
  variant = "standalone"
}: Props) {
  const { colors } = useTheme();
  const [showWhyMissing, setShowWhyMissing] = useState(false);
  const sessionMode = resolveSessionActivityUiMode(marketStatus);
  const sessionClosed = sessionMode === "closed";
  const sessionExtended = sessionMode === "extended";
  const deskSessionStale = isDeskSessionActivityStale(deskData, sessionMode);
  const effectiveDeskData = deskSessionStale ? null : deskData;
  const effectiveAlternateDesk = deskSessionStale ? null : alternateDeskData;
  const { leaders, source } = resolveDiscoveryLeaders(
    effectiveDeskData,
    gapFallback,
    mode,
    effectiveAlternateDesk
  );
  const leaderSymbols = useMemo(() => leaders.map((l) => l.symbol), [leaders]);
  const sinceLastVisit = useMemo(() => {
    const previous = loadDeskLastVisit(mode);
    return diffDeskSinceLastVisit(leaderSymbols, previous);
  }, [leaderSymbols, mode]);
  const sinceSummary = useMemo(() => {
    if (leaderSymbols.length === 0) return null;
    return sinceLastVisitSummary(sinceLastVisit.added, sinceLastVisit.removed);
  }, [leaderSymbols.length, sinceLastVisit.added, sinceLastVisit.removed]);

  useEffect(() => {
    if (leaderSymbols.length === 0) return;
    saveDeskLastVisit(leaderSymbols, mode);
  }, [leaderSymbols, mode]);

  const rowModels = useMemo(
    () => buildSessionActivityRowModels(leaders, { mode, source, sessionMode }),
    [leaders, mode, source, sessionMode]
  );

  const footnote = deskScanFootnote(effectiveDeskData);
  const updated = formatGeneratedAtEt(effectiveDeskData?.generated_at ?? deskData?.generated_at);
  const scannerHref = dualDeskSurfaces
    ? `/dashboard/scanner?mode=${mode === "swing" ? "swing" : "day"}`
    : "/dashboard/scanner?mode=swing";
  const scannerRetainedHref = `${scannerHref}&retained=1`;
  const retainedCount = Math.max(
    0,
    Number(
      effectiveDeskData?.retained_pool?.length ??
        effectiveDeskData?.survivor_limit_used ??
        0
    )
  );
  const scannerHover = useHoverPrefetch(scannerHref);
  const scannerRetainedHover = useHoverPrefetch(scannerRetainedHref);
  const deskCacheMiss = deskSource === "cache_miss" || (deskData == null && deskSource !== "cache");
  const embedded = variant === "pipeline";
  const subtitle = hotInMarketFeedSubtitle({
    source,
    count: leaders.length,
    deskLoading: isLoading,
    scannerPending,
    deskCacheMiss,
    sessionActivityLoading,
    sessionMode,
    mode
  });
  const sessionSuffix = sessionActivitySubtitleSuffix(sessionMode);
  const awaitingData =
    leaders.length === 0 &&
    (isLoading ||
      refreshBusy ||
      sessionActivityLoading ||
      deskSessionStale ||
      (scannerPending && deskCacheMiss && gapFallback.length === 0));
  const needsDeskLoad = leaders.length === 0 && deskCacheMiss && !awaitingData;
  const pipelineLoadingOnly = embedded && awaitingData && !needsDeskLoad;

  const shellStyle = embedded
    ? { padding: 0, border: "none", background: "transparent", borderRadius: 0 }
    : {
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      };

  return (
    <section
      role="region"
      aria-label="Market activity"
      data-testid="dashboard-discovery-feed"
      className={embedded ? undefined : surfaceGlowClassName}
      style={shellStyle}
    >
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
              {MARKET_ACTIVITY_TITLE}
            </h2>
            <p
              className="m-0 mt-1"
              data-testid="dashboard-hot-in-market-subtitle"
              style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
            >
              {subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {updated ? (
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Updated {updated}</span>
            ) : null}
            {onRefreshDesk ? (
              <DeskRefreshButton
                onClick={() => onRefreshDesk()}
                busy={refreshBusy}
                disabled={!canRefreshDesk}
                cooldownLabel={refreshCooldownLabel}
                label="Refresh desk"
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="m-0 text-sm tabular-nums"
            data-testid="dashboard-hot-in-market-subtitle"
            style={{ color: colors.textMuted }}
          >
            {subtitle}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {updated ? (
              <span className="text-xs tabular-nums" style={{ color: colors.textMuted }}>
                {updated}
              </span>
            ) : null}
            {onRefreshDesk ? (
              <DeskRefreshButton
                onClick={() => onRefreshDesk()}
                busy={refreshBusy}
                disabled={!canRefreshDesk}
                cooldownLabel={refreshCooldownLabel}
                label={needsDeskLoad ? "Load movers" : "Refresh"}
              />
            ) : null}
          </div>
        </div>
      )}

      {sinceSummary ? (
        <p
          className="m-0 mt-2"
          data-testid="dashboard-since-last-visit"
          style={{ fontSize: typography.scale.xs, color: colors.textMuted }}
        >
          Since you were here: {sinceSummary}
        </p>
      ) : null}

      {refreshError ? (
        <p
          className="m-0 mt-2"
          data-testid="dashboard-hot-in-market-refresh-error"
          style={{ fontSize: typography.scale.xs, color: colors.caution, lineHeight: 1.45 }}
        >
          {refreshError}
        </p>
      ) : null}

      {sessionClosed && leaders.length > 0 ? (
        <p
          className="m-0 mt-3 text-sm font-medium leading-snug"
          data-testid="dashboard-session-activity-closed"
          style={{ color: colors.text }}
        >
          {sessionActivityClosedSummary(leaders.length)}
        </p>
      ) : null}

      {sessionExtended && sessionSuffix ? (
        <p
          className="m-0 mt-3 text-xs leading-snug"
          data-testid="dashboard-session-activity-extended"
          style={{ color: colors.textMuted }}
        >
          {sessionSuffix}
        </p>
      ) : null}

      {rowModels.length > 0 ? (
        <div className="mt-3">
          <DashboardOpportunityListSection
            rows={rowModels}
            demoteGap
            testId="dashboard-discovery-list"
            collapseAllUntilExpand={sessionClosed}
            expandTestId="dashboard-session-activity-expand"
            expandLabel={(n) =>
              `View ${n} logged ${n === 1 ? "mover" : "movers"}`
            }
          />
        </div>
      ) : awaitingData && !pipelineLoadingOnly ? (
        <p
          className="m-0 mt-3"
          data-testid="dashboard-hot-in-market-loading"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {deskSessionStale
            ? sessionActivityAwaitingTodayMessage()
            : hotInMarketAwaitingMessage({
                deskLoading: isLoading,
                scannerPending,
                deskCacheMiss,
                sessionActivityLoading
              })}
        </p>
      ) : awaitingData ? null : (
        <div
          className="mt-3 rounded-xl p-4"
          data-testid="dashboard-hot-in-market-empty"
          style={{
            border: `1px dashed ${colors.border}`,
            background: `color-mix(in srgb, ${colors.surfaceMuted} 50%, transparent)`
          }}
        >
          <p className="m-0 text-sm leading-snug" style={{ color: colors.text }}>
            {hotInMarketEmptyMessage(deskCacheMiss, {
              loadInHeader: embedded && needsDeskLoad
            })}
          </p>
          {needsDeskLoad && onRefreshDesk && !embedded ? (
            <div className="mt-3">
              <DeskRefreshButton
                onClick={() => onRefreshDesk()}
                busy={refreshBusy}
                disabled={!canRefreshDesk}
                cooldownLabel={refreshCooldownLabel}
                label="Load session movers"
              />
            </div>
          ) : null}
        </div>
      )}

      <DashboardMissedTodayStrip mode={mode} deskData={effectiveDeskData} gapFallback={gapFallback} />

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowWhyMissing((v) => !v)}
          data-testid="dashboard-why-missing-toggle"
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surfaceMuted,
            color: colors.text,
            padding: `${spacing[1]} ${spacing[2]}`,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          {showWhyMissing ? "Hide why missing" : "Why missing lookup"}
        </button>
      </div>
      {showWhyMissing ? (
        <div className="mt-3">
          <ScannerWhyMissingPanel
            rejectedSamples={effectiveDeskData?.rejected_samples ?? []}
            rejectionReasonCounts={effectiveDeskData?.rejection_reason_counts}
            suggestedSymbols={leaders.map((l) => l.symbol)}
            showSymbolSuggestions={false}
            deskModeForLookup={mode}
          />
        </div>
      ) : null}

      {footnote ? (
        <p className="m-0 mt-3" style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          {footnote}
        </p>
      ) : null}

      <p className="m-0 mt-2">
        <Link
          href={scannerHref}
          prefetch={false}
          data-hover-prefetch="true"
          {...interactionLevelProps("deep")}
          {...scannerHover}
          data-testid="dashboard-discovery-scanner-link"
          style={{ fontSize: typography.scale.sm, color: colors.accent, fontWeight: 600 }}
        >
          Open Scanner for patterns →
        </Link>
      </p>
      {retainedCount > 0 ? (
        <p className="m-0 mt-1">
          <Link
            href={scannerRetainedHref}
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            {...scannerRetainedHover}
            data-testid="dashboard-discovery-retained-link"
            style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}
          >
            Browse retained pool ({retainedCount}) →
          </Link>
        </p>
      ) : null}
    </section>
  );
}
