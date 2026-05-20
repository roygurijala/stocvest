"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { DevelopingMovementGroups } from "@/lib/scanner/scanner-quiet-desk";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  groups: DevelopingMovementGroups;
  totalCount: number;
};

export function ScannerDevelopingUniverse({ groups, totalCount }: Props) {
  const { colors } = useTheme();
  const hasAny =
    groups.improving.length > 0 || groups.stable.length > 0 || groups.weakening.length > 0;

  if (!hasAny) return null;

  return (
    <section
      data-testid="scanner-developing-universe"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <header style={{ marginBottom: spacing[3] }}>
        <h3
          style={{
            margin: 0,
            fontSize: typography.scale.base,
            fontWeight: 700,
            color: colors.text
          }}
        >
          Other setups forming (market-wide)
        </h3>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {totalCount} symbol{totalCount === 1 ? "" : "s"} with partial alignment · sorted by readiness
        </p>
      </header>

      <div style={{ display: "grid", gap: spacing[3] }}>
        <MovementGroup label="Improving ↑" rows={groups.improving} testId="scanner-dev-improving" />
        <MovementGroup label="Stable →" rows={groups.stable} testId="scanner-dev-stable" />
        <MovementGroup label="Weakening ↓" rows={groups.weakening} testId="scanner-dev-weakening" />
      </div>
    </section>
  );
}

function MovementGroup({
  label,
  rows,
  testId
}: {
  label: string;
  rows: DevelopingMovementGroups["improving"];
  testId: string;
}) {
  const { colors } = useTheme();
  if (rows.length === 0) return null;

  return (
    <div data-testid={testId}>
      <p
        style={{
          margin: `0 0 ${spacing[1]}`,
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        {label}
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
        {rows.map((row) => (
          <li
            key={`${row.symbol}-${row.desk}`}
            data-testid={`scanner-dev-row-${row.symbol}`}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing[2],
              padding: spacing[2],
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceMuted
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold" style={{ color: colors.text }}>
                  {row.symbol}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: `2px ${spacing[1]}`,
                    borderRadius: borderRadius.sm,
                    color: row.directionLabel === "Short" ? colors.bearish : colors.bullish,
                    border: `1px solid ${row.directionLabel === "Short" ? colors.bearish : colors.bullish}`
                  }}
                >
                  {row.directionLabel}
                </span>
                <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.caution }}>
                  {row.alignmentLabel}
                </span>
              </div>
              <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                {row.missingHint}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {row.movementSuffix ? (
                <span
                  style={{
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    color:
                      row.movement === "improving"
                        ? colors.bullish
                        : row.movement === "weakening"
                          ? colors.bearish
                          : colors.textMuted
                  }}
                >
                  {row.movementSuffix}
                </span>
              ) : null}
              <Link href={row.watchlistHref} style={{ fontSize: typography.scale.xs, color: colors.accent }}>
                Watchlist →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
