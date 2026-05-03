"use client";

import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

function Shimmer({ height, width = "100%" }: { height: number; width?: string | number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        width: typeof width === "number" ? `${width}px` : width,
        borderRadius: 6,
        background: "linear-gradient(90deg, rgba(148,163,184,0.08), rgba(148,163,184,0.16), rgba(148,163,184,0.08))",
        backgroundSize: "200% 100%",
        animation: "stocvest-dash-sk 1.1s ease-in-out infinite"
      }}
    />
  );
}

/** Shown instantly while dashboard data streams in — keeps shell + sidebar usable. */
export function DashboardPageSkeleton() {
  const { colors } = useTheme();
  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <style>{`@keyframes stocvest-dash-sk { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }`}</style>
      <article
        style={{
          borderBottom: `1px solid ${colors.border}`,
          paddingBottom: spacing[3],
          display: "flex",
          justifyContent: "space-between",
          gap: spacing[3],
          flexWrap: "wrap"
        }}
      >
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((k) => (
            <div
              key={k}
              className={surfaceGlowClassName}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                background: colors.surfaceMuted
              }}
            >
              <Shimmer height={14} width="40%" />
              <div style={{ marginTop: spacing[2] }}>
                <Shimmer height={36} />
              </div>
            </div>
          ))}
        </div>
        <Shimmer height={40} width={120} />
      </article>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className={`min-h-[200px] ${surfaceGlowClassName}`} style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4], background: colors.surface }}>
          <Shimmer height={16} width="50%" />
          <div style={{ marginTop: spacing[4] }}>
            <Shimmer height={120} />
          </div>
        </div>
        <div className={`min-h-[200px] ${surfaceGlowClassName}`} style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4], background: colors.surface }}>
          <Shimmer height={16} width="40%" />
          <div style={{ marginTop: spacing[3], display: "grid", gap: spacing[2] }}>
            <Shimmer height={48} />
            <Shimmer height={48} />
            <Shimmer height={48} />
          </div>
        </div>
      </div>
      <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>Loading market data and scanner…</p>
    </section>
  );
}
