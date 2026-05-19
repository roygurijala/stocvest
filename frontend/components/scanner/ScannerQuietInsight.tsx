"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ClosestQualifyingGroup } from "@/lib/scanner-quiet-copy";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";
import { ScannerEvaluationDetails } from "@/components/scanner/ScannerEvaluationDetails";

type Props = {
  bullets: string[];
  closestGroups: ClosestQualifyingGroup[];
  synthesis?: ScannerSynthesis | null;
  traceRows?: ScannerEvaluationTraceRow[];
  deskFilter?: "swing" | "day" | "all";
};

/**
 * Single optional drill-down on quiet scans — keeps the default view minimal.
 * Market scope stays in the header; this block is for symbols + gates + trace.
 */
export function ScannerQuietInsight({
  bullets,
  closestGroups,
  synthesis,
  traceRows = [],
  deskFilter = "all"
}: Props) {
  const { colors } = useTheme();
  const hasClosest = closestGroups.length > 0;
  const hasWhy = bullets.length > 0;
  const hasEval =
    (synthesis?.rejection_groups.session_volume.length ?? 0) +
      (synthesis?.rejection_groups.liquidity.length ?? 0) +
      (synthesis?.rejection_groups.structure.length ?? 0) >
      0 || traceRows.length > 0;

  if (!hasClosest && !hasWhy && !hasEval) return null;

  return (
    <details
      data-testid="scanner-quiet-insight"
      className="scanner-quiet-insight"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.border} 80%, transparent)`,
        background: colors.surfaceMuted,
        padding: spacing[3]
      }}
    >
      <summary
        className="scanner-quiet-insight__summary"
        style={{
          fontSize: typography.scale.sm,
          fontWeight: 600,
          color: colors.textMuted,
          cursor: "pointer",
          listStyle: "none"
        }}
      >
        Scan insight
      </summary>
      <div style={{ marginTop: spacing[3], display: "grid", gap: spacing[3] }}>
        {hasClosest ? (
          <div data-testid="scanner-closest-to-qualifying">
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                color: colors.textMuted
              }}
            >
              Closest to qualifying
            </p>
            {closestGroups.map((group) => (
              <ul
                key={group.label}
                style={{
                  margin: group === closestGroups[0] ? 0 : `${spacing[2]} 0 0`,
                  padding: 0,
                  listStyle: "none",
                  display: "grid",
                  gap: 4
                }}
              >
                {group.items.map((row) => (
                  <li
                    key={`${group.label}-${row.symbol}`}
                    data-testid={`scanner-closest-${row.symbol}`}
                    style={{ fontSize: typography.scale.sm, color: colors.text }}
                  >
                    <span className="font-mono font-semibold">{row.symbol}</span>
                    <span style={{ color: colors.textMuted }}> · {row.detail}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        ) : null}

        {hasWhy ? (
          <ul
            style={{
              margin: 0,
              padding: `0 0 0 ${spacing[3]}`,
              display: "grid",
              gap: 4,
              fontSize: typography.scale.sm,
              color: colors.textMuted,
              lineHeight: 1.45
            }}
          >
            {bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        {hasEval ? (
          <ScannerEvaluationDetails synthesis={synthesis} traceRows={traceRows} deskFilter={deskFilter} />
        ) : null}
      </div>
    </details>
  );
}
