"use client";

import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { SnapshotPayload } from "@/lib/api/market";
import { DashboardDiscoveryFeed } from "@/components/dashboard/dashboard-discovery-feed";
import { DashboardQuietLeadersFeed } from "@/components/dashboard/dashboard-quiet-leaders-feed";
import { DashboardWatchlistRadar } from "@/components/dashboard/dashboard-watchlist-radar";
import { PipelineSectionNote } from "@/components/dashboard/pipeline-section-note";
import { PipelineStagePanel } from "@/components/dashboard/pipeline-stage-panel";
import {
  buildPipelineStatusLine,
  OPPORTUNITY_PIPELINE_INTRO,
  OPPORTUNITY_PIPELINE_TITLE,
  PIPELINE_STAGES
} from "@/lib/dashboard/dashboard-opportunity-pipeline-present";
import { WATCHLIST_RADAR_DISCLAIMER } from "@/lib/dashboard/watchlist-radar-card-present";
import { MARKET_ACTIVITY_DISCLAIMER } from "@/lib/dashboard/hot-in-market-card-present";
import { QUIET_LEADERS_DISCLAIMER } from "@/lib/dashboard/quiet-leaders-present";
import type { WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar-attention";
import { quietLeadersFromDesk } from "@/lib/dashboard/quiet-leaders-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  deskSource?: string | null;
  alternateDeskData?: DeskTodayData | null | undefined;
  gapFallback: GapIntelligenceItem[];
  deskLoading?: boolean;
  scannerPending?: boolean;
  dualDeskSurfaces?: boolean;
  onRefreshDesk?: () => void;
  refreshBusy?: boolean;
  canRefreshDesk?: boolean;
  refreshCooldownLabel?: string | null;
  refreshError?: string | null;
  snapshots: SnapshotPayload[];
  desk: WatchlistRadarDeskContext;
  nearReadyInMarket: number;
  marketActivityCount: number;
  watchlistAttentionCount: number;
  onWatchlistAttentionCount?: (count: number) => void;
};

export function DashboardOpportunityPipeline({
  mode,
  deskData,
  deskSource = null,
  alternateDeskData,
  gapFallback,
  deskLoading = false,
  scannerPending = false,
  dualDeskSurfaces = true,
  onRefreshDesk,
  refreshBusy = false,
  canRefreshDesk = false,
  refreshCooldownLabel = null,
  refreshError = null,
  snapshots,
  desk,
  nearReadyInMarket,
  marketActivityCount,
  watchlistAttentionCount,
  onWatchlistAttentionCount
}: Props) {
  const { colors } = useTheme();
  const quietCount = mode === "swing" ? quietLeadersFromDesk(deskData).length : 0;
  const statusLine = buildPipelineStatusLine({
    mode,
    watchlistAttentionCount,
    quietLeadersCount: quietCount,
    marketActivityCount,
    nearReadyInMarket,
    systemSuppressed: desk.systemSuppressed
  });

  const marketStageNumber = mode === "swing" ? 3 : 2;

  return (
    <section
      role="region"
      aria-label="Opportunity pipeline"
      data-testid="dashboard-opportunity-pipeline"
      style={{ display: "grid", gap: spacing[4] }}
    >
      <header
        style={{
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          padding: spacing[4]
        }}
      >
        <h2 className="m-0" style={{ fontSize: typography.scale.lg, fontWeight: 700 }}>
          {OPPORTUNITY_PIPELINE_TITLE}
        </h2>
        <p
          className="m-0 mt-1.5 text-sm leading-snug"
          data-testid="dashboard-pipeline-status"
          style={{ color: colors.text }}
        >
          {statusLine}
        </p>
        <PipelineSectionNote testId="dashboard-pipeline-intro-note">{OPPORTUNITY_PIPELINE_INTRO}</PipelineSectionNote>
      </header>

      <PipelineStagePanel
        stageId="watchlist"
        stageNumber={1}
        label={PIPELINE_STAGES.watchlist.label}
        hint="Symbols you track — layer progress and near-ready"
      >
        <DashboardWatchlistRadar
          mode={mode}
          snapshots={snapshots}
          desk={desk}
          variant="pipeline"
          onAttentionCountChange={onWatchlistAttentionCount}
        />
        <PipelineSectionNote testId="dashboard-watchlist-pipeline-note">
          {WATCHLIST_RADAR_DISCLAIMER}
        </PipelineSectionNote>
      </PipelineStagePanel>

      {mode === "swing" ? (
        <PipelineStagePanel
          stageId="quiet"
          stageNumber={2}
          label={PIPELINE_STAGES.quiet.label}
          hint="Strong structure before the session heats up (move under 2%)"
        >
          <DashboardQuietLeadersFeed mode={mode} deskData={deskData} isLoading={deskLoading} variant="pipeline" />
          <PipelineSectionNote testId="dashboard-quiet-pipeline-note">{QUIET_LEADERS_DISCLAIMER}</PipelineSectionNote>
        </PipelineStagePanel>
      ) : null}

      <PipelineStagePanel
        stageId="market"
        stageNumber={marketStageNumber}
        label={PIPELINE_STAGES.market.label}
        hint="What moved today — context only, not entries"
      >
        <DashboardDiscoveryFeed
          mode={mode}
          deskData={deskData}
          deskSource={deskSource}
          alternateDeskData={alternateDeskData}
          gapFallback={gapFallback}
          isLoading={deskLoading}
          scannerPending={scannerPending}
          dualDeskSurfaces={dualDeskSurfaces}
          onRefreshDesk={onRefreshDesk}
          refreshBusy={refreshBusy}
          canRefreshDesk={canRefreshDesk}
          refreshCooldownLabel={refreshCooldownLabel}
          refreshError={refreshError}
          variant="pipeline"
        />
        <PipelineSectionNote testId="dashboard-market-pipeline-note">
          {MARKET_ACTIVITY_DISCLAIMER}
        </PipelineSectionNote>
      </PipelineStagePanel>
    </section>
  );
}
