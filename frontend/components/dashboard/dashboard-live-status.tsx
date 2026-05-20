"use client";

import Link from "next/link";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import type { LiveStatusCopy } from "@/lib/dashboard/live-status-copy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  status: LiveStatusCopy;
};

export function DashboardLiveStatus({ status }: Props) {
  const { colors } = useTheme();
  const prefetch = useHoverPrefetch(status.ctaHref);

  return (
    <section
      role="region"
      aria-label="Live status"
      data-testid="dashboard-live-status"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Live status (right now)
      </p>
      <h3
        style={{
          margin: `${spacing[2]} 0 0`,
          fontSize: typography.scale.base,
          fontWeight: 700,
          color: colors.text
        }}
      >
        {status.deskTitle}
      </h3>
      <hr
        style={{
          margin: `${spacing[2]} 0`,
          border: "none",
          borderTop: `1px solid color-mix(in srgb, ${colors.border} 70%, transparent)`
        }}
      />
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
        {status.headline}
      </p>
      {status.suppressedCallout ? (
        <p
          data-testid="dashboard-live-status-suppressed"
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.sm,
            color: colors.caution,
            lineHeight: 1.5
          }}
        >
          {status.suppressedCallout}
        </p>
      ) : null}
      <Link
        href={status.ctaHref}
        prefetch={false}
        data-hover-prefetch="true"
        {...interactionLevelProps("deep")}
        onMouseEnter={prefetch.onMouseEnter}
        onFocus={prefetch.onFocus}
        onPointerDown={prefetch.onPointerDown}
        className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold"
        style={{ color: colors.accent }}
      >
        {status.ctaLabel}
      </Link>
    </section>
  );
}
