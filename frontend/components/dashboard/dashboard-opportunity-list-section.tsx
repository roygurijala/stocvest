"use client";

import { useState } from "react";
import { DashboardOpportunityRowList } from "@/components/dashboard/dashboard-opportunity-row";
import type { OpportunityRowModel } from "@/lib/dashboard/opportunity-row-present";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  rows: OpportunityRowModel[];
  testId: string;
  demoteGap?: boolean;
  /** When set, only this many rows show until the user expands. */
  previewCount?: number;
  expandTestId?: string;
  /** When true, no rows render until expanded (summary-only mode). */
  collapseAllUntilExpand?: boolean;
  expandLabel?: (hiddenCount: number) => string;
};

export function DashboardOpportunityListSection({
  rows,
  testId,
  demoteGap = false,
  previewCount,
  expandTestId = "dashboard-opportunity-list-expand",
  collapseAllUntilExpand = false,
  expandLabel
}: Props) {
  const { colors } = useTheme();
  const canExpand =
    collapseAllUntilExpand || (previewCount != null && rows.length > previewCount);
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) return null;

  const hiddenCount = collapseAllUntilExpand
    ? rows.length
    : previewCount != null
      ? Math.max(0, rows.length - previewCount)
      : 0;

  let visibleRows: OpportunityRowModel[] = rows;
  if (collapseAllUntilExpand && !expanded) {
    visibleRows = [];
  } else if (previewCount != null && !expanded && rows.length > previewCount) {
    visibleRows = rows.slice(0, previewCount);
  }

  const label =
    expandLabel?.(hiddenCount) ??
    (collapseAllUntilExpand
      ? `View ${hiddenCount} logged ${hiddenCount === 1 ? "mover" : "movers"}`
      : `Show ${hiddenCount} more`);

  return (
    <div data-testid={`${testId}-section`}>
      {visibleRows.length > 0 ? (
        <DashboardOpportunityRowList rows={visibleRows} demoteGap={demoteGap} testId={testId} />
      ) : null}
      {canExpand && hiddenCount > 0 && !expanded ? (
        <button
          type="button"
          className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-left"
          data-testid={expandTestId}
          onClick={() => setExpanded(true)}
          style={{
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.accent
          }}
        >
          {label}
        </button>
      ) : null}
      {canExpand && expanded && hiddenCount > 0 && !collapseAllUntilExpand ? (
        <button
          type="button"
          className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-left"
          data-testid={`${expandTestId}-collapse`}
          onClick={() => setExpanded(false)}
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: colors.textMuted
          }}
        >
          Show less
        </button>
      ) : null}
      {canExpand && expanded && collapseAllUntilExpand ? (
        <button
          type="button"
          className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-left"
          data-testid={`${expandTestId}-collapse`}
          onClick={() => setExpanded(false)}
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: colors.textMuted
          }}
        >
          Hide logged movers
        </button>
      ) : null}
    </div>
  );
}
