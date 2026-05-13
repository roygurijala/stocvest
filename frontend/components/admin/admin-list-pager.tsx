"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Reusable token-based pager for admin list surfaces.
 *
 * **Why token-based instead of numbered pages?**
 * Cognito (and several other upstream services we proxy: DynamoDB
 * queries, audit log scans, parameter history queries) return only
 * an opaque "next page" token — there's no global row count, so
 * "Page 5 of 23" is structurally impossible without a separate
 * `count()` round-trip. This pager keeps the API contract honest:
 * we show `Page N` (1-indexed) and Prev / Next, where the existence
 * of a Next token is the only thing that tells us another page is
 * available.
 *
 * **Usage contract for callers.**
 * The parent owns:
 *   * A `tokenStack: string[]` whose length is the current page
 *     index (0 = first page, no tokens consumed yet).
 *   * A `nextToken: string | null` from the latest API response.
 * Prev = pop the top of the stack and refetch with the new top.
 * Next = push `nextToken` and refetch with it as the page token.
 *
 * Disabling rules:
 *   * Prev disabled iff `pageIndex === 0`.
 *   * Next disabled iff `nextToken == null` OR `loading`.
 *
 * **Not for every list.** This is for admin lists that fetch from
 * paginated upstream services. Dashboard surfaces with bounded data
 * (e.g. weekly performance buckets) don't need this — render them
 * all and skip the pager entirely.
 */
export interface AdminListPagerProps {
  /** 0-indexed page number. ``0`` = first page. */
  pageIndex: number;
  /** Whether a "next page" affordance should be enabled. */
  hasNext: boolean;
  /** Whether a "previous page" affordance should be enabled. */
  hasPrev: boolean;
  /** Disable both controls (used during in-flight fetches). */
  loading?: boolean;
  /** Number of rows actually rendered on this page. */
  visibleCount: number;
  /** Page size the API was asked to return (display only). */
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  /** Optional test id override. */
  testId?: string;
}

export function AdminListPager({
  pageIndex,
  hasNext,
  hasPrev,
  loading = false,
  visibleCount,
  pageSize,
  onPrev,
  onNext,
  testId = "admin-list-pager"
}: AdminListPagerProps) {
  const { colors } = useTheme();
  const prevDisabled = !hasPrev || loading;
  const nextDisabled = !hasNext || loading;
  return (
    <nav
      data-testid={testId}
      data-page-index={pageIndex}
      data-has-next={hasNext ? "true" : "false"}
      data-has-prev={hasPrev ? "true" : "false"}
      aria-label="Pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[3],
        padding: `${spacing[2]} ${spacing[3]}`,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        background: colors.surface
      }}
    >
      <span
        data-testid={`${testId}-status`}
        style={{
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        Page {pageIndex + 1} · {visibleCount} of up to {pageSize} rows
      </span>
      <div style={{ display: "flex", gap: spacing[2] }}>
        <PagerButton
          onClick={onPrev}
          disabled={prevDisabled}
          testId={`${testId}-prev`}
          label="Previous"
          icon={<ChevronLeft size={14} aria-hidden />}
          iconSide="left"
        />
        <PagerButton
          onClick={onNext}
          disabled={nextDisabled}
          testId={`${testId}-next`}
          label="Next"
          icon={<ChevronRight size={14} aria-hidden />}
          iconSide="right"
        />
      </div>
    </nav>
  );
}

function PagerButton({
  onClick,
  disabled,
  testId,
  label,
  icon,
  iconSide
}: {
  onClick: () => void;
  disabled: boolean;
  testId: string;
  label: string;
  icon: React.ReactNode;
  iconSide: "left" | "right";
}) {
  const { colors } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        padding: `${spacing[1]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${disabled ? colors.border : colors.accent}`,
        background: disabled ? "transparent" : "rgba(59,130,246,0.10)",
        color: disabled ? colors.textMuted : colors.accent,
        fontSize: typography.scale.sm,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1
      }}
    >
      {iconSide === "left" ? icon : null}
      {label}
      {iconSide === "right" ? icon : null}
    </button>
  );
}
