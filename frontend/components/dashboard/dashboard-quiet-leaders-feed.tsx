"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { HotInMarketCard } from "@/components/dashboard/hot-in-market-card";
import {
  buildingStructureBackfillNote,
  buildingStructureEmptyMessage,
  buildBuildingStructureCardModel,
  resolveBuildingStructureRows
} from "@/lib/dashboard/building-structure-present";
import {
  QUIET_LEADERS_SUBTITLE,
  QUIET_LEADERS_TITLE,
  quietLeadersScannerHref
} from "@/lib/dashboard/quiet-leaders-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  nearQualification?: ScannerNearQualificationRow[];
  sessionActivitySymbols?: string[];
  isLoading?: boolean;
  variant?: "standalone" | "pipeline";
};

export function DashboardQuietLeadersFeed({
  mode,
  deskData,
  nearQualification = [],
  sessionActivitySymbols = [],
  isLoading = false,
  variant = "standalone"
}: Props) {
  const { colors } = useTheme();
  const structureRows = useMemo(() => {
    if (mode !== "swing") return [];
    return resolveBuildingStructureRows({
      deskData,
      nearQualification,
      sessionActivitySymbols
    });
  }, [deskData, mode, nearQualification, sessionActivitySymbols]);

  const backfillNote = useMemo(() => buildingStructureBackfillNote(structureRows), [structureRows]);

  const cardModels = useMemo(
    () =>
      structureRows.map((row, index) =>
        buildBuildingStructureCardModel(row, {
          rank: index + 1,
          mode: "swing",
          deskData,
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
    [
      structureRows,
      deskData,
      colors.accent,
      colors.bearish,
      colors.bullish,
      colors.border,
      colors.caution,
      colors.surface,
      colors.textMuted
    ]
  );

  if (mode !== "swing") return null;

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
      aria-label="Quiet leaders"
      data-testid="dashboard-quiet-leaders-feed"
      className={embedded ? undefined : surfaceGlowClassName}
      style={shellStyle}
    >
      {!embedded ? (
        <div>
          <h2 className="m-0" style={{ fontSize: typography.scale.base, fontWeight: 700 }}>
            {QUIET_LEADERS_TITLE}
          </h2>
          <p className="m-0 mt-1" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
            {QUIET_LEADERS_SUBTITLE}
          </p>
        </div>
      ) : null}

      {cardModels.length > 0 ? (
        <>
          {backfillNote ? (
            <p
              className="m-0 mt-2"
              data-testid="dashboard-building-structure-backfill-note"
              style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}
            >
              {backfillNote}
            </p>
          ) : null}
          <ul
            className={`m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3 ${backfillNote ? "mt-2" : "mt-3"}`}
            data-testid="dashboard-quiet-leaders-list"
          >
            {cardModels.map((model) => (
              <HotInMarketCard key={model.symbol} model={model} mode="swing" />
            ))}
          </ul>
        </>
      ) : (
        <p
          className="m-0 mt-3"
          data-testid="dashboard-quiet-leaders-empty"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {isLoading
            ? "Scanning for low-velocity leaders…"
            : buildingStructureEmptyMessage(sessionActivitySymbols.length)}
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
