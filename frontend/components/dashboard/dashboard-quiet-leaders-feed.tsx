"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { MarketStatusPayload } from "@/lib/api/market";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { DashboardOpportunityListSection } from "@/components/dashboard/dashboard-opportunity-list-section";
import { BUILDING_STRUCTURE_PREVIEW_COUNT } from "@/lib/dashboard/opportunity-row-present";
import {
  buildingStructureAwaitingDeskMessage,
  buildingStructureBackfillNote,
  buildingStructureDeskChecked,
  buildingStructureLoadedEmptyMessage,
  buildingStructureLoadingMessage,
  buildBuildingStructureRowModels,
  resolveBuildingStructureRows
} from "@/lib/dashboard/building-structure-present";
import { buildingStructureListHeadline } from "@/lib/dashboard/opportunity-row-present";
import {
  QUIET_LEADERS_SCANNER_LINK_LABEL,
  QUIET_LEADERS_SUBTITLE,
  QUIET_LEADERS_TITLE,
  quietLeadersScannerHref
} from "@/lib/dashboard/quiet-leaders-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { resolveSessionActivityUiMode } from "@/lib/market/session-activity-mode";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  deskData: DeskTodayData | null | undefined;
  nearQualification?: ScannerNearQualificationRow[];
  sessionActivitySymbols?: string[];
  marketStatus?: MarketStatusPayload | null;
  isLoading?: boolean;
  deskSource?: string | null;
  variant?: "standalone" | "pipeline";
};

export function DashboardQuietLeadersFeed({
  mode,
  deskData,
  nearQualification = [],
  sessionActivitySymbols = [],
  marketStatus = null,
  isLoading = false,
  deskSource = null,
  variant = "standalone"
}: Props) {
  const { colors } = useTheme();
  const sessionMode = resolveSessionActivityUiMode(marketStatus);
  const structureRows = useMemo(() => {
    if (mode !== "swing") return [];
    return resolveBuildingStructureRows({
      deskData,
      nearQualification,
      sessionActivitySymbols
    });
  }, [deskData, mode, nearQualification, sessionActivitySymbols]);

  const backfillNote = useMemo(() => buildingStructureBackfillNote(structureRows), [structureRows]);
  const listHeadline = useMemo(() => buildingStructureListHeadline(structureRows), [structureRows]);

  const rowModels = useMemo(
    () =>
      buildBuildingStructureRowModels({
        rows: structureRows,
        mode: "swing",
        deskData,
        sessionMode
      }),
    [structureRows, deskData, sessionMode]
  );

  if (mode !== "swing") return null;

  const deskChecked = buildingStructureDeskChecked(isLoading, deskSource, deskData);
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

      {rowModels.length > 0 ? (
        <>
          {listHeadline ? (
            <p
              className={`m-0 text-xs font-semibold uppercase tracking-wide ${embedded ? "mt-0" : "mt-3"}`}
              data-testid="dashboard-building-structure-headline"
              style={{ color: colors.textMuted }}
            >
              {listHeadline}
            </p>
          ) : null}
          {backfillNote ? (
            <p
              className="m-0 mt-2"
              data-testid="dashboard-building-structure-backfill-note"
              style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}
            >
              {backfillNote}
            </p>
          ) : null}
          <div className={listHeadline || backfillNote ? "mt-2" : embedded ? "" : "mt-3"}>
            <DashboardOpportunityListSection
              rows={rowModels}
              testId="dashboard-quiet-leaders-list"
              previewCount={BUILDING_STRUCTURE_PREVIEW_COUNT}
              expandTestId="dashboard-building-structure-expand"
            />
          </div>
        </>
      ) : (
        <p
          className="m-0 mt-3"
          data-testid="dashboard-quiet-leaders-empty"
          style={{ fontSize: typography.scale.sm, color: colors.textMuted }}
        >
          {isLoading
            ? buildingStructureLoadingMessage()
            : deskChecked
              ? buildingStructureLoadedEmptyMessage(sessionActivitySymbols.length)
              : buildingStructureAwaitingDeskMessage()}
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
          {QUIET_LEADERS_SCANNER_LINK_LABEL}
        </Link>
      </p>
    </section>
  );
}
