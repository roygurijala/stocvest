"use client";

import { InfoTip } from "@/components/info-tip";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const UNIVERSE_STRIP_TIP =
  "How many symbols the swing scanner universe covers and how many names received a gap-intelligence snapshot this session. Read-only context — open the Scanner for full gap and setup lists.";

export type DashboardUniverseStripProps = {
  swingUniverseSymbolCount: number | null;
  gapSnapshotSymbolCount: number | null;
  scannerError?: string;
  dualDeskSurfaces?: boolean;
};

function formatCount(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString();
}

/** Level 4 — read-only universe counts (not a navigation target). */
export function DashboardUniverseStrip({
  swingUniverseSymbolCount,
  gapSnapshotSymbolCount,
  scannerError,
  dualDeskSurfaces = true
}: DashboardUniverseStripProps) {
  const { colors } = useTheme();

  return (
    <div
      role="region"
      aria-label="Active universe"
      data-testid="dashboard-universe-strip"
      {...interactionLevelProps("none")}
      className={surfaceGlowClassName}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing[3],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <span
        style={{
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Active universe
      </span>
      <span style={{ fontSize: typography.scale.sm, color: colors.text }}>
        <strong>Swing scan:</strong> {formatCount(swingUniverseSymbolCount)} symbols
        {dualDeskSurfaces ? (
          <>
            {" "}
            · <strong>Gap snapshots:</strong> {formatCount(gapSnapshotSymbolCount)}
          </>
        ) : null}
      </span>
      {scannerError ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.caution }}>{scannerError}</span>
      ) : null}
      <span {...interactionLevelProps("light")} className="inline-flex">
        <InfoTip text={UNIVERSE_STRIP_TIP} label="About active universe counts" maxWidth={320} />
      </span>
    </div>
  );
}
