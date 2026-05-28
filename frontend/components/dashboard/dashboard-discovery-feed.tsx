"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { DeskRefreshButton } from "@/components/dashboard/desk-refresh-button";
import { HotInMarketCard } from "@/components/dashboard/hot-in-market-card";
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
  buildHotInMarketCardModel,
  hotInMarketAwaitingMessage,
  hotInMarketEmptyMessage,
  hotInMarketFeedSubtitle,
  MARKET_ACTIVITY_TITLE
} from "@/lib/dashboard/hot-in-market-card-present";
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
  scannerPending?: boolean;
  dualDeskSurfaces?: boolean;
  onRefreshDesk?: () => void;
  refreshBusy?: boolean;
  canRefreshDesk?: boolean;
  refreshCooldownLabel?: string | null;
  refreshError?: string | null;
  variant?: "standalone" | "pipeline";
};

export function DashboardDiscoveryFeed({
  mode,
  deskData,
  deskSource = null,
  alternateDeskData,
  gapFallback,
  isLoading = false,
  scannerPending = false,
  dualDeskSurfaces = true,
  onRefreshDesk,
  refreshBusy = false,
  canRefreshDesk = false,
  refreshCooldownLabel = null,
  refreshError = null,
  variant = "standalone"
}: Props) {
  const { colors } = useTheme();
  const { leaders, source } = resolveDiscoveryLeaders(deskData, gapFallback, mode, alternateDeskData);
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

  const cardModels = useMemo(
    () =>
      leaders.map((leader, index) =>
        buildHotInMarketCardModel(leader, {
          rank: index + 1,
          mode,
          source,
          colors: {
            surface: colors.surface,
            border: colors.border,
            accent: colors.accent,
            bullish: colors.bullish,
            bearish: colors.bearish,
            caution: colors.caution,
            textMuted: colors.textMuted
          }
        })
      ),
    [leaders, mode, source, colors.accent, colors.bullish, colors.bearish, colors.caution, colors.textMuted]
  );

  const footnote = deskScanFootnote(deskData);
  const updated = formatGeneratedAtEt(deskData?.generated_at);
  const scannerHref = dualDeskSurfaces
    ? `/dashboard/scanner?mode=${mode === "swing" ? "swing" : "day"}`
    : "/dashboard/scanner?mode=swing";
  const scannerHover = useHoverPrefetch(scannerHref);
  const deskCacheMiss = deskSource === "cache_miss" || (deskData == null && deskSource !== "cache");
  const subtitle = hotInMarketFeedSubtitle({
    source,
    count: leaders.length,
    deskLoading: isLoading,
    scannerPending,
    deskCacheMiss,
    mode
  });
  const awaitingData =
    leaders.length === 0 &&
    (isLoading || refreshBusy || (scannerPending && deskCacheMiss && gapFallback.length === 0));
  const needsDeskLoad = leaders.length === 0 && deskCacheMiss && !awaitingData;

  const embedded = variant === "pipeline";
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

      {cardModels.length > 0 ? (
        <ul
          className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="dashboard-discovery-list"
        >
          {cardModels.map((model) => (
            <HotInMarketCard key={model.symbol} model={model} mode={mode} />
          ))}
        </ul>
      ) : awaitingData ? (
        <p
          className="m-0 mt-3"
          data-testid="dashboard-hot-in-market-loading"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {hotInMarketAwaitingMessage({ deskLoading: isLoading, scannerPending, deskCacheMiss })}
        </p>
      ) : (
        <div
          className="mt-3 rounded-xl p-4"
          data-testid="dashboard-hot-in-market-empty"
          style={{
            border: `1px dashed ${colors.border}`,
            background: `color-mix(in srgb, ${colors.surfaceMuted} 50%, transparent)`
          }}
        >
          <p className="m-0 text-sm leading-snug" style={{ color: colors.text }}>
            {hotInMarketEmptyMessage(deskCacheMiss)}
          </p>
          {needsDeskLoad && onRefreshDesk ? (
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

      <DashboardMissedTodayStrip mode={mode} deskData={deskData} gapFallback={gapFallback} />

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
    </section>
  );
}
