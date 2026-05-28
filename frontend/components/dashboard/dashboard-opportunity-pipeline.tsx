"use client";

import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { SnapshotPayload } from "@/lib/api/market";
import { DashboardDiscoveryFeed } from "@/components/dashboard/dashboard-discovery-feed";
import { DashboardQuietLeadersFeed } from "@/components/dashboard/dashboard-quiet-leaders-feed";
import { DashboardWatchlistRadar } from "@/components/dashboard/dashboard-watchlist-radar";
import {
  buildPipelineStatusLine,
  OPPORTUNITY_PIPELINE_INTRO,
  OPPORTUNITY_PIPELINE_TITLE,
  PIPELINE_STAGES
} from "@/lib/dashboard/dashboard-opportunity-pipeline-present";
import type { WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar-attention";
import { quietLeadersFromDesk } from "@/lib/dashboard/quiet-leaders-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
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

function PipelineStageHeader({
  stage,
  stageNumber
}: {
  stage: (typeof PIPELINE_STAGES)[keyof typeof PIPELINE_STAGES];
  stageNumber: number;
}) {
  const { colors } = useTheme();
  return (
    <div className="flex flex-wrap items-baseline gap-2" data-testid={`pipeline-stage-${stage.id}`}>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums uppercase tracking-wider"
        style={{
          background: `color-mix(in srgb, ${colors.accent} 14%, transparent)`,
          color: colors.accent
        }}
      >
        {stageNumber}
      </span>
      <h3 className="m-0 text-sm font-bold" style={{ color: colors.text }}>
        {stage.label}
      </h3>
      <span className="text-xs" style={{ color: colors.textMuted }}>
        {stage.subtitle}
      </span>
    </div>
  );
}

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

  return (
    <section
      role="region"
      aria-label="Opportunity pipeline"
      data-testid="dashboard-opportunity-pipeline"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <header>
        <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
          {OPPORTUNITY_PIPELINE_TITLE}
        </h2>
        <p
          className="m-0 mt-1"
          data-testid="dashboard-pipeline-status"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}
        >
          {statusLine}
        </p>
        <p
          className="m-0 mt-2"
          style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, maxWidth: "52rem" }}
        >
          {OPPORTUNITY_PIPELINE_INTRO}
        </p>
      </header>

      <div className="mt-4 grid gap-4">
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[3]
          }}
        >
          <PipelineStageHeader stage={PIPELINE_STAGES.watchlist} stageNumber={1} />
          <div className="mt-2">
            <DashboardWatchlistRadar
              mode={mode}
              snapshots={snapshots}
              desk={desk}
              variant="pipeline"
              onAttentionCountChange={onWatchlistAttentionCount}
            />
          </div>
        </div>

        {mode === "swing" ? (
          <div
            style={{
              borderTop: `1px solid ${colors.border}`,
              paddingTop: spacing[3]
            }}
          >
            <PipelineStageHeader stage={PIPELINE_STAGES.quiet} stageNumber={2} />
            <div className="mt-2">
              <DashboardQuietLeadersFeed mode={mode} deskData={deskData} isLoading={deskLoading} variant="pipeline" />
            </div>
          </div>
        ) : null}

        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[3]
          }}
        >
          <PipelineStageHeader stage={PIPELINE_STAGES.market} stageNumber={mode === "swing" ? 3 : 2} />
          <div className="mt-2">
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
          </div>
        </div>
      </div>
    </section>
  );
}
