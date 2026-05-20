"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildDailyPulseRollup, type DailyPulseRollup } from "@/lib/dashboard-daily-pulse";
import {
  buildOpportunityCards,
  OPPORTUNITIES_GUIDE_LINE
} from "@/lib/dashboard/opportunities-overview";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { normalizeWatchlistMaturationBySymbol } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  dayTradingSurfaces: boolean;
  scanSummary?: ScannerScanSummary | null;
  watchlistStatus?: WatchlistDashboardStatus | null;
};

export function DashboardOpportunitiesOverview({
  mode,
  dayTradingSurfaces,
  scanSummary,
  watchlistStatus
}: Props) {
  const { colors } = useTheme();
  const [rollup, setRollup] = useState<DailyPulseRollup>({ swing: null, day: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fetches = dayTradingSurfaces
          ? [
              fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" }),
              fetch("/api/stocvest/watchlists/maturation-summary?mode=day", { cache: "no-store" })
            ]
          : [fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" })];
        const results = await Promise.all(fetches);
        if (cancelled || !results[0]?.ok) return;
        const swingJson = await results[0].json().catch(() => ({}));
        const dayJson = results[1] ? await results[1].json().catch(() => ({})) : {};
        const next = buildDailyPulseRollup({
          swingBySymbol: normalizeWatchlistMaturationBySymbol(swingJson),
          dayBySymbol: dayTradingSurfaces ? normalizeWatchlistMaturationBySymbol(dayJson) : {},
          includeDayDesk: dayTradingSurfaces
        });
        if (!cancelled) setRollup(next);
      } catch {
        /* pulse is optional enrichment for watchlist card */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayTradingSurfaces]);

  const cards = useMemo(
    () =>
      buildOpportunityCards({
        mode,
        scanSummary,
        watchlistStatus,
        pulseDesk: mode === "swing" ? rollup.swing : rollup.day
      }),
    [mode, scanSummary, watchlistStatus, rollup.swing, rollup.day]
  );

  return (
    <section role="region" aria-label="Opportunities overview" data-testid="dashboard-opportunities">
      <p
        style={{
          margin: `0 0 ${spacing[2]}`,
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Opportunities overview
      </p>
      <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.sm, color: colors.textMuted }}>
        {OPPORTUNITIES_GUIDE_LINE}
      </p>
      <div
        data-testid="dashboard-next-actions"
        className="grid gap-3 sm:grid-cols-3"
        style={{ alignItems: "stretch" }}
      >
        {cards.map((card) => (
          <OpportunityCardBlock key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function OpportunityCardBlock({
  card
}: {
  card: ReturnType<typeof buildOpportunityCards>[number];
}) {
  const { colors } = useTheme();
  const prefetch = useHoverPrefetch(card.ctaHref);

  return (
    <article
      data-testid={`dashboard-opportunity-${card.id}`}
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: card.emphasize
          ? `1px solid color-mix(in srgb, ${colors.accent} 55%, ${colors.border})`
          : `1px solid ${colors.border}`,
        background: card.emphasize
          ? `color-mix(in srgb, ${colors.accent} 6%, ${colors.surface})`
          : colors.surface,
        padding: spacing[3],
        minWidth: 0
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: card.emphasize ? typography.scale.base : typography.scale.sm,
          fontWeight: 700,
          color: colors.text
        }}
      >
        {card.title}
      </p>
      <hr
        style={{
          margin: `${spacing[2]} 0`,
          border: "none",
          borderTop: `1px solid color-mix(in srgb, ${colors.border} 70%, transparent)`
        }}
      />
      <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.textMuted, fontSize: typography.scale.sm }}>
        {card.lines.map((line) => (
          <li key={line} style={{ marginBottom: spacing[1] }}>
            {line}
          </li>
        ))}
      </ul>
      <Link
        href={card.ctaHref}
        prefetch={false}
        data-hover-prefetch="true"
        {...interactionLevelProps(card.emphasize ? "deep" : "medium")}
        onMouseEnter={prefetch.onMouseEnter}
        onFocus={prefetch.onFocus}
        onPointerDown={prefetch.onPointerDown}
        className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold"
        style={{ color: card.emphasize ? colors.accent : colors.textMuted }}
      >
        {card.ctaLabel}
      </Link>
    </article>
  );
}
