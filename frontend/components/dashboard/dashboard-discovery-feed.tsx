"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { HotInMarketCard } from "@/components/dashboard/hot-in-market-card";
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
  HOT_IN_MARKET_DISCLAIMER,
  HOT_IN_MARKET_TITLE,
  hotInMarketSignalsHref,
  hotInMarketSourceSubtitle
} from "@/lib/dashboard/hot-in-market-card-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  gapFallback: GapIntelligenceItem[];
  isLoading?: boolean;
  dualDeskSurfaces?: boolean;
  onRefreshDesk?: () => void;
  refreshBusy?: boolean;
  canRefreshDesk?: boolean;
  refreshCooldownLabel?: string | null;
  refreshError?: string | null;
};

export function DashboardDiscoveryFeed({
  mode,
  deskData,
  gapFallback,
  isLoading = false,
  dualDeskSurfaces = true,
  onRefreshDesk,
  refreshBusy = false,
  canRefreshDesk = false,
  refreshCooldownLabel = null,
  refreshError = null
}: Props) {
  const { colors } = useTheme();
  const { leaders, source } = resolveDiscoveryLeaders(deskData, gapFallback, mode);
  const leaderSymbols = useMemo(() => leaders.map((l) => l.symbol), [leaders]);
  const sinceLastVisit = useMemo(() => {
    const previous = loadDeskLastVisit();
    return diffDeskSinceLastVisit(leaderSymbols, previous);
  }, [leaderSymbols]);
  const sinceSummary = useMemo(
    () => sinceLastVisitSummary(sinceLastVisit.added, sinceLastVisit.removed),
    [sinceLastVisit.added, sinceLastVisit.removed]
  );

  useEffect(() => {
    if (leaderSymbols.length === 0) return;
    saveDeskLastVisit(leaderSymbols);
  }, [leaderSymbols]);

  const cardModels = useMemo(
    () =>
      leaders.map((leader, index) =>
        buildHotInMarketCardModel(leader, {
          rank: index + 1,
          mode,
          source,
          colors: {
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

  const recentlyHot = Array.isArray(deskData?.recently_hot) ? deskData!.recently_hot!.slice(0, 5) : [];
  const footnote = deskScanFootnote(deskData);
  const updated = formatGeneratedAtEt(deskData?.generated_at);
  const scannerHref = dualDeskSurfaces
    ? `/dashboard/scanner?mode=${mode === "swing" ? "swing" : "day"}`
    : "/dashboard/scanner?mode=swing";
  const scannerHover = useHoverPrefetch(scannerHref);
  const subtitle = isLoading
    ? "Refreshing opportunity desk…"
    : hotInMarketSourceSubtitle(source, leaders.length);

  return (
    <section
      role="region"
      aria-label="Hot in market opportunities"
      data-testid="dashboard-discovery-feed"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
            {HOT_IN_MARKET_TITLE}
          </h2>
          <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
            {subtitle}
          </p>
          <p
            className="m-0 mt-2"
            data-testid="dashboard-hot-in-market-disclaimer"
            style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, maxWidth: "52rem" }}
          >
            {HOT_IN_MARKET_DISCLAIMER}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {updated ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Updated {updated}</span>
          ) : null}
          {onRefreshDesk ? (
            <button
              type="button"
              data-testid="dashboard-discovery-refresh-desk"
              disabled={!canRefreshDesk || refreshBusy}
              onClick={() => onRefreshDesk()}
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: borderRadius.full,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceMuted,
                color: canRefreshDesk ? colors.accent : colors.textMuted,
                cursor: canRefreshDesk && !refreshBusy ? "pointer" : "not-allowed"
              }}
            >
              {refreshBusy
                ? "Refreshing…"
                : refreshCooldownLabel
                  ? `Refresh in ${refreshCooldownLabel}`
                  : "Refresh desk"}
            </button>
          ) : null}
        </div>
      </div>

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
        <p className="m-0 mt-1" style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
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
      ) : null}

      {recentlyHot.length > 0 ? (
        <div className="mt-3" data-testid="dashboard-recently-hot">
          <p
            className="m-0"
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Recently hot
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recentlyHot.map((row) => (
              <Link
                key={row.symbol}
                href={hotInMarketSignalsHref(row.symbol, mode)}
                prefetch={false}
                {...interactionLevelProps("deep")}
                data-testid={`dashboard-recently-hot-${row.symbol}`}
                style={{
                  fontSize: typography.scale.xs,
                  padding: "4px 10px",
                  borderRadius: borderRadius.full,
                  border: `1px dashed ${colors.border}`,
                  color: colors.textMuted
                }}
              >
                {row.symbol} · dropped off top list
              </Link>
            ))}
          </div>
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
    </section>
  );
}
