"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { HotInMarketCard } from "@/components/dashboard/hot-in-market-card";
import {
  buildQuietLeaderCardModel,
  QUIET_LEADERS_DISCLAIMER,
  QUIET_LEADERS_SUBTITLE,
  QUIET_LEADERS_TITLE,
  quietLeadersFromDesk,
  quietLeadersScannerHref
} from "@/lib/dashboard/quiet-leaders-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  isLoading?: boolean;
};

export function DashboardQuietLeadersFeed({ mode, deskData, isLoading = false }: Props) {
  const { colors } = useTheme();
  const leaders = useMemo(() => {
    if (mode !== "swing") return [];
    return quietLeadersFromDesk(deskData);
  }, [deskData, mode]);

  const cardModels = useMemo(
    () =>
      leaders.map((leader, index) =>
        buildQuietLeaderCardModel(leader, {
          rank: index + 1,
          mode: "swing",
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
    [leaders, colors.accent, colors.bearish, colors.bullish, colors.border, colors.caution, colors.surface, colors.textMuted]
  );

  if (mode !== "swing") return null;

  return (
    <section
      role="region"
      aria-label="Quiet leaders"
      data-testid="dashboard-quiet-leaders-feed"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <div>
        <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
          {QUIET_LEADERS_TITLE}
        </h2>
        <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
          {QUIET_LEADERS_SUBTITLE}
        </p>
        <p
          className="m-0 mt-2"
          style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, maxWidth: "52rem" }}
        >
          {QUIET_LEADERS_DISCLAIMER}
        </p>
      </div>

      {cardModels.length > 0 ? (
        <ul
          className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="dashboard-quiet-leaders-list"
        >
          {cardModels.map((model) => (
            <HotInMarketCard key={model.symbol} model={model} mode="swing" />
          ))}
        </ul>
      ) : (
        <p
          className="m-0 mt-3"
          data-testid="dashboard-quiet-leaders-empty"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {isLoading
            ? "Scanning for low-velocity leaders with strong swing structure…"
            : "No quiet leaders this load — names appear after the full desk scan when structure is strong but session move is under 2%."}
        </p>
      )}

      <p className="m-0 mt-2">
        <Link
          href={quietLeadersScannerHref("swing")}
          prefetch={false}
          {...interactionLevelProps("deep")}
          data-testid="dashboard-quiet-leaders-scanner-link"
          style={{ fontSize: typography.scale.sm, color: colors.accent, fontWeight: 600 }}
        >
          View on Scanner →
        </Link>
      </p>
    </section>
  );
}
