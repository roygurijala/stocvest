"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import { InfoTip } from "@/components/info-tip";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

const DISCOVERY_TIP =
  "Gap leaders ranked by gap-quality score. Expand for the list (no page change). Open Scanner for full gap intelligence and scenario builder.";

export type DashboardDiscoveryRowProps = {
  gapIntelligence: GapIntelligenceItem[];
  scannerError?: string;
  dualDeskSurfaces?: boolean;
  /** Fires when the Level-2 gap leaders `<details>` opens or closes (assistant context). */
  onDiscoveryExpandedChange?: (expanded: boolean) => void;
};

function gapDirectionLabel(pct: number): string {
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return "flat";
}

function sortGaps(items: GapIntelligenceItem[]): GapIntelligenceItem[] {
  return [...items].sort((a, b) => {
    const sa = typeof a.gap_quality_score === "number" ? a.gap_quality_score : 0;
    const sb = typeof b.gap_quality_score === "number" ? b.gap_quality_score : 0;
    return sb - sa;
  });
}

/** Level 2 — expandable gap discovery summary; Level 1 deep link to Scanner only in footer. */
export function DashboardDiscoveryRow({
  gapIntelligence,
  scannerError,
  dualDeskSurfaces = true,
  onDiscoveryExpandedChange
}: DashboardDiscoveryRowProps) {
  const { colors } = useTheme();
  const scannerHref = dualDeskSurfaces ? "/dashboard/scanner?mode=both" : "/dashboard/scanner?mode=swing";
  const hoverPrefetch = useHoverPrefetch(scannerHref);

  const leaders = useMemo(() => sortGaps(gapIntelligence).slice(0, 10), [gapIntelligence]);
  const preview = leaders.slice(0, 3);
  const withCatalyst = leaders.filter((g) => g.has_catalyst).length;

  if (scannerError) {
    return null;
  }

  return (
    <section
      data-testid="dashboard-discovery-row"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 style={{ margin: 0, fontSize: typography.scale.md, fontWeight: 700 }}>Discovery engine</h3>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>
            {leaders.length === 0
              ? "No symbols passed gap filters this session."
              : `${leaders.length} gap leader${leaders.length === 1 ? "" : "s"} · ${withCatalyst} with catalyst`}
          </p>
        </div>
        <span {...interactionLevelProps("light")} className="inline-flex shrink-0">
          <InfoTip text={DISCOVERY_TIP} label="About discovery engine" maxWidth={320} />
        </span>
      </div>

      {preview.length > 0 ? (
        <div
          {...interactionLevelProps("none")}
          className="mt-3 flex flex-wrap gap-2"
          data-testid="dashboard-discovery-preview"
        >
          {preview.map((g) => (
            <span
              key={g.symbol}
              data-testid={`discovery-preview-${g.symbol}`}
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: borderRadius.full,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceMuted,
                color: colors.text
              }}
            >
              {g.symbol}{" "}
              <span style={{ color: colors.textMuted, fontWeight: 500 }}>
                {gapDirectionLabel(g.gap_pct)} {Math.abs(g.gap_pct).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {leaders.length > 0 ? (
        <details
          className="mt-3"
          data-testid="dashboard-discovery-details"
          {...interactionLevelProps("medium")}
          onToggle={(event) => {
            onDiscoveryExpandedChange?.((event.currentTarget as HTMLDetailsElement).open);
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: typography.scale.sm,
              fontWeight: 600,
              color: colors.accent,
              listStylePosition: "outside"
            }}
          >
            View gap leaders ({leaders.length})
          </summary>
          <ul
            className="m-0 mt-2 grid list-none gap-2 p-0"
            style={{ fontSize: typography.scale.sm }}
            data-testid="dashboard-discovery-leader-list"
          >
            {leaders.map((g) => (
              <li
                key={g.symbol}
                data-testid={`discovery-leader-${g.symbol}`}
                style={{
                  padding: spacing[2],
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceMuted
                }}
              >
                <strong>{g.symbol}</strong>
                <span style={{ color: colors.textMuted }}> · {g.company_name}</span>
                <span style={{ color: colors.textMuted }}>
                  {" "}
                  · {gapDirectionLabel(g.gap_pct)} {Math.abs(g.gap_pct).toFixed(1)}%
                  {g.has_catalyst && g.catalyst?.category ? ` · ${g.catalyst.category}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="m-0 mt-3" style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
        <Link
          href={scannerHref}
          prefetch={false}
          {...interactionLevelProps("deep")}
          {...hoverPrefetch}
          data-testid="dashboard-discovery-scanner-link"
          style={{ color: colors.accent, fontWeight: 600 }}
        >
          Open full gap intelligence in Scanner →
        </Link>
      </p>
    </section>
  );
}
