"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  nearReadyInMarket: number;
};

export function DashboardInsightCallout({ mode, nearReadyInMarket }: Props) {
  const { colors } = useTheme();
  const href = mode === "swing" ? "/dashboard/scanner?mode=swing" : "/dashboard/scanner?mode=day";
  const prefetch = useHoverPrefetch(href);

  return (
    <aside
      role="note"
      aria-label="Insight"
      data-testid="dashboard-insight"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.accent} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`,
        padding: spacing[4]
      }}
    >
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
        Quiet conditions are normal
      </p>
      <p style={{ margin: `${spacing[2]} 0`, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
        0–2 signals/week · {nearReadyInMarket > 0 ? `${nearReadyInMarket} near-ready setup${nearReadyInMarket === 1 ? "" : "s"}` : "3–8 near-ready setups"} on a typical scan day
      </p>
      <Link
        href={href}
        prefetch={false}
        data-hover-prefetch="true"
        {...interactionLevelProps("medium")}
        onMouseEnter={prefetch.onMouseEnter}
        onFocus={prefetch.onFocus}
        onPointerDown={prefetch.onPointerDown}
        className="inline-flex min-h-10 items-center text-sm font-semibold"
        style={{ color: colors.accent }}
      >
        Monitor Scanner for changes →
      </Link>
    </aside>
  );
}
