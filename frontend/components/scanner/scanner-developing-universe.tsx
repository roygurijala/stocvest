"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { DevelopingMovementGroups, DevelopingRowModel } from "@/lib/scanner/scanner-quiet-desk";
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
          Market-wide activity
        </h3>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {totalCount} symbol{totalCount === 1 ? "" : "s"} at ≥3/6 alignment · sorted by readiness
        </p>
      </header>

      <div style={{ display: "grid", gap: spacing[3] }}>
        <MovementGroup label="Improving ↑" rows={groups.improving} testId="scanner-dev-improving" defaultOpen />
        <MovementGroup label="Stable →" rows={groups.stable} testId="scanner-dev-stable" defaultOpen />
        <MovementGroup
          label="Weakening ↓"
          rows={groups.weakening}
          testId="scanner-dev-weakening"
          defaultOpen={false}
          collapsibleWhenMany={3}
        />
      </div>
    </section>
  );
}

function MovementGroup({
  label,
  rows,
  testId,
  defaultOpen,
  collapsibleWhenMany
}: {
  label: string;
  rows: DevelopingRowModel[];
  testId: string;
  defaultOpen: boolean;
  collapsibleWhenMany?: number;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;

  const shouldCollapse =
    collapsibleWhenMany != null && rows.length >= collapsibleWhenMany && !defaultOpen;
  const collapsed = shouldCollapse && !open;

  return (
    <div data-testid={testId}>
      {shouldCollapse ? (
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={!collapsed}
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing[1],
            margin: `0 0 ${spacing[1]}`,
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          <ChevronDown
            size={14}
            style={{ transform: collapsed ? undefined : "rotate(180deg)", transition: "transform 0.15s ease" }}
          />
          {label} ({rows.length} symbol{rows.length === 1 ? "" : "s"})
        </button>
      ) : (
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
      )}
      {collapsed ? null : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
          {rows.map((row) => (
            <DevelopingRow key={`${row.symbol}-${row.desk}`} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DevelopingRow({ row }: { row: DevelopingRowModel }) {
  const { colors } = useTheme();
  const movementColor =
    row.movement === "improving"
      ? colors.bullish
      : row.movement === "weakening"
        ? colors.bearish
        : colors.textMuted;

  return (
    <li
      data-testid={`scanner-dev-row-${row.symbol}-${row.desk}`}
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
            {row.displaySymbol}
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
          <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: movementColor }}>
            {row.alignmentLabel}
          </span>
        </div>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {row.missingHint}
        </p>
      </div>
      <Link href={row.watchlistHref} style={{ fontSize: typography.scale.xs, color: colors.accent }}>
        Watchlist →
      </Link>
    </li>
  );
}
