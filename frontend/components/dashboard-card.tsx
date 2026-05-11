"use client";

import type { ReactNode } from "react";
import {
  borderRadius,
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
   * Desk-role color encoding — Mode Separation B28 (Phase 2 color language).
   *
   * Three orthogonal channels of meaning on the dashboard: (1) price direction
   * green/red, (2) caution amber, (3) DESK ROLE — slate/indigo/teal — handled
   * here. When `role` is set, the card surface tint, left-edge stripe, and
   * top-left pill switch to that role's accent so a user can answer
   * "is this swing, day, or shared context?" by hue alone.
   *
   * Omit `role` to keep the legacy theme-accent surface (used by surfaces that
   * are not part of the desk taxonomy yet — e.g. settings / legal pages).
   */
  role?: CardRole;
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
  role,
  ...rest
}: DashboardCardProps) {
  const { theme, colors } = useTheme();
  const dataAttrs = Object.fromEntries(
    Object.entries(rest).filter(([k]) => k.startsWith("data-"))
  );
  const roleAccent: RoleAccent | null = role ? roleAccents[theme][role] : null;
  // When a role is active, the card surface, edge stripe, and border lean on the role accent
  // instead of the global theme accent. Tints are kept SOFT (5-10%) — the goal is unambiguous
  // hue recognition, not visual shouting. The left-edge stripe (3px) carries the strongest
  // signal so the role is readable even from a peripheral glance.
  const surfaceAccent = roleAccent?.accent ?? colors.accent;
  const cardBackground = roleAccent
    ? `linear-gradient(145deg, color-mix(in srgb, ${surfaceAccent} 9%, ${colors.surface}) 0%, ${colors.surface} 55%, ${colors.surface} 100%)`
    : `linear-gradient(145deg, color-mix(in srgb, ${colors.accent} 7%, ${colors.surface}) 0%, ${colors.surface} 42%, ${colors.surface} 100%)`;
  const cardBorder = `1px solid color-mix(in srgb, ${colors.border} 80%, ${surfaceAccent} 20%)`;
  const cardShadow = `0 18px 48px rgba(0,0,0,0.22), 0 0 0 1px color-mix(in srgb, ${surfaceAccent} 14%, transparent)`;

  return (
    <article
      {...dataAttrs}
      data-card-role={role ?? undefined}
      className={`${surfaceGlowClassName} ${className ?? ""}`.trim()}
      style={{
        position: "relative",
        background: cardBackground,
        border: cardBorder,
        borderRadius: borderRadius["2xl"],
        padding: spacing[5],
        boxShadow: cardShadow,
        overflow: "hidden",
        ...style
      }}
    >
      {roleAccent ? (
        // Left-edge role stripe — 3px solid bar along the inside of the rounded border.
        // Placed BEHIND content (zIndex 0) and the rest of the card sits in the normal
        // flow so this never intercepts pointer events. This is the strongest visual
        // signal of role identity and is what makes the card readable from a peripheral
        // glance.
        <span
          aria-hidden
          data-testid="dashboard-card-role-stripe"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: 3,
            background: surfaceAccent,
            pointerEvents: "none"
          }}
        />
      ) : null}
      {roleAccent ? (
        // Role pill — sits above the eyebrow, anchored to the top-left of the card.
        // Carries the verbatim role label ("SHARED CONTEXT" / "SWING · MULTI-DAY" /
        // "DAY · INTRADAY") so screenshots are self-explanatory. Tests anchor on the
        // exact label via `data-card-role-pill="..."`.
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
            border: `1px solid color-mix(in srgb, ${surfaceAccent} 55%, ${colors.border})`,
            background: `color-mix(in srgb, ${surfaceAccent} 16%, transparent)`,
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
