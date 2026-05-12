"use client";

import type { ReactNode } from "react";
import {
  borderRadius,
  cardSurfaceStyle,
  roleAccents,
  spacing,
  surfaceGlowClassName,
  typography,
  type CardRole,
  type RoleAccent
} from "@/lib/design-system";
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
  /**
   * Desk-role identifier — Mode Separation B28.
   *
   * When set, the card surfaces a small labelled pill ("SHARED CONTEXT" /
   * "SWING · MULTI-DAY" / "DAY · INTRADAY") top-left, plus a 4px-wide
   * role-tinted `borderLeft` accent. Everything else — surface color,
   * radius, padding, halo — uses the canonical
   * {@link cardSurfaceStyle} shell so dashboard cards look and feel
   * identical to Signals page, Scanner page, and Performance page cards.
   *
   * Phase 2b's bright 2px rail border, 4px top rail, 3px left stripe, and
   * 9% role-tinted gradient were removed when the user asked for uniform
   * look-and-feel across the application; role identity is now encoded by
   * the labelled pill + the subtle 4px left accent (the same pattern
   * Scanner gap cards use for the `caution` "no catalyst" flag).
   *
   * Omit `role` for surfaces that are not part of the desk taxonomy
   * (settings / legal / future).
   */
  role?: CardRole;
  /** data-* attributes spread on the wrapping <article> — used by tests for stable DOM anchors
   *  (e.g. data-testid, data-day-desk-posture). React passes data-* through automatically. */
  [dataAttr: `data-${string}`]: string | undefined;
};

/**
 * Consistent dashboard panel: title block + circled info (i) top-right, themed surface.
 *
 * Shell delegates to {@link cardSurfaceStyle} so every dashboard card sits on
 * the same visual contract as the rest of the application (Signals, Scanner,
 * Performance, Evidence sub-panels). Role identity layered on top via a
 * labelled pill + a subtle 4px-wide `borderLeft` accent.
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
  role,
  ...rest
}: DashboardCardProps) {
  const { theme, colors } = useTheme();
  const dataAttrs = Object.fromEntries(
    Object.entries(rest).filter(([k]) => k.startsWith("data-"))
  );
  const roleAccent: RoleAccent | null = role ? roleAccents[theme][role] : null;
  const shell = cardSurfaceStyle(colors, "neutral");

  return (
    <article
      {...dataAttrs}
      data-card-role={role ?? undefined}
      className={`${surfaceGlowClassName} ${className ?? ""}`.trim()}
      style={{
        position: "relative",
        background: shell.background,
        border: shell.border,
        borderLeft: roleAccent ? `4px solid ${roleAccent.accent}` : shell.border,
        borderRadius: borderRadius.xl,
        padding: spacing[4],
        boxShadow: shell.boxShadow,
        overflow: "hidden",
        ...style
      }}
    >
      {roleAccent ? (
        // Role pill — labelled tag at top-left. Same small-pill pattern used
        // for "NOT INVESTMENT ADVICE" on the Evidence card; combined with the
        // 4px borderLeft accent it tells the user "what layer of thinking am
        // I in?" without competing visually with the rest of the page.
        <span
          data-testid="dashboard-card-role-pill"
          data-card-role-pill={role}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[1],
            alignSelf: "flex-start",
            marginBottom: spacing[3],
            paddingInline: spacing[2],
            paddingBlock: 2,
            borderRadius: borderRadius.full,
            border: `1px solid color-mix(in srgb, ${roleAccent.accent} 45%, ${colors.border})`,
            background: `color-mix(in srgb, ${roleAccent.accent} 12%, transparent)`,
            color: roleAccent.accentStrong,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            lineHeight: 1
          }}
        >
          {roleAccent.pillLabel}
        </span>
      ) : null}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: spacing[3],
          marginBottom: spacing[3],
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
