"use client";

import { CuteLoader } from "@/components/cute-loader";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/** Shown instantly while dashboard data streams in — keeps shell + sidebar usable. */
export function DashboardPageSkeleton() {
  const { colors } = useTheme();
  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        className={surfaceGlowClassName}
        style={{
          minHeight: 340,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          background: colors.surface,
          display: "grid",
          placeItems: "center",
          padding: spacing[6]
        }}
      >
        <CuteLoader label="Loading dashboard" sublabel="Pulling scanner, market, and earnings data" />
      </article>
    </section>
  );
}
