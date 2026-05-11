"use client";

import type { ReactNode } from "react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { InfoTip } from "@/components/info-tip";

export type DashboardCardProps = {
  title: string;
  /** Short label above the title (uppercase tracking). */
  eyebrow?: string;
  subtitle?: ReactNode;
  /** Shown in the circled (i) top-right — what this panel is for. */
  cardTip: string;
  /** Optional node beside the info icon (e.g. session badge). */
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** data-* attributes spread on the wrapping <article> — used by tests for stable DOM anchors
   *  (e.g. data-testid, data-day-desk-posture). React passes data-* through automatically. */
  [dataAttr: `data-${string}`]: string | undefined;
};

/**
 * Consistent dashboard panel: title block + circled info (i) top-right, themed surface.
 */
export function DashboardCard({
  title,
  eyebrow,
  subtitle,
  cardTip,
  headerRight,
  children,
  className,
  style,
  ...rest
}: DashboardCardProps) {
  const { colors } = useTheme();
  const dataAttrs = Object.fromEntries(
    Object.entries(rest).filter(([k]) => k.startsWith("data-"))
  );
  return (
    <article
      {...dataAttrs}
      className={`${surfaceGlowClassName} ${className ?? ""}`.trim()}
      style={{
        position: "relative",
        background: `linear-gradient(145deg, color-mix(in srgb, ${colors.accent} 7%, ${colors.surface}) 0%, ${colors.surface} 42%, ${colors.surface} 100%)`,
        border: `1px solid color-mix(in srgb, ${colors.border} 85%, ${colors.accent} 15%)`,
        borderRadius: borderRadius["2xl"],
        padding: spacing[5],
        boxShadow: `0 18px 48px rgba(0,0,0,0.22), 0 0 0 1px color-mix(in srgb, ${colors.accent} 12%, transparent)`,
        ...style
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: spacing[3],
          marginBottom: spacing[4],
          paddingBottom: spacing[3],
          borderBottom: `1px solid color-mix(in srgb, ${colors.border} 70%, transparent)`
        }}
      >
        <div className="min-w-0" style={{ display: "grid", gap: spacing[1] }}>
          {eyebrow ? (
            <span
              data-testid="dashboard-card-eyebrow"
              style={{
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: colors.textMuted
              }}
            >
              {eyebrow}
            </span>
          ) : null}
          <h3 style={{ margin: 0, fontSize: typography.scale.xl, fontWeight: 700, letterSpacing: "-0.02em", color: colors.text }}>
            {title}
          </h3>
          {subtitle ? (
            <div style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: typography.lineHeight.relaxed }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {headerRight}
          <InfoTip text={cardTip} label={`About ${title}`} maxWidth={300} />
        </div>
      </header>
      {children}
    </article>
  );
}
