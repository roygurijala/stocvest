"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import { buildWatchlistQuietInsight } from "@/lib/scanner-quiet-copy";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  watchlist: WatchlistDashboardStatus;
  qualifyingTotal: number;
};

export function ScannerWatchlistInsightCard({ watchlist, qualifyingTotal }: Props) {
  const { colors } = useTheme();
  const copy = buildWatchlistQuietInsight(watchlist, qualifyingTotal);
  if (!copy) return null;

  return (
    <section
      data-testid="scanner-watchlist-insight-card"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid color-mix(in srgb, ${colors.accent} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.accent} 10%, ${colors.surface})`
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: typography.scale.sm,
          fontWeight: 700,
          color: colors.text,
          lineHeight: 1.4
        }}
      >
        {copy.headline}
      </p>
      <p
        data-testid="scanner-watchlist-insight-subline"
        style={{
          margin: `${spacing[2]} 0 0`,
          fontSize: typography.scale.sm,
          color: colors.textMuted,
          lineHeight: 1.5
        }}
      >
        {copy.subline}
      </p>
      <Link
        href="/dashboard/watchlists"
        style={{
          display: "inline-block",
          marginTop: spacing[2],
          fontSize: typography.scale.sm,
          fontWeight: 600,
          color: colors.accent,
          textDecoration: "none"
        }}
      >
        View watchlist →
      </Link>
    </section>
  );
}
