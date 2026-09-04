/**
 * ADR-003 UX-D5 — Trading Room card chrome (pure).
 *
 * Fewer 1px boxes; surface-step hierarchy; unified section labels;
 * motion on expand surfaces via animationDurations.normal (240ms).
 */

import type { CSSProperties } from "react";
import { animationDurations, borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";

export const TRADING_ROOM_SECTION_LABEL = {
  fontSize: 10,
  fontWeight: 700 as const,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const
};

export function tradingRoomSectionLabelStyle(colors: ThemeColors): CSSProperties {
  return {
    ...TRADING_ROOM_SECTION_LABEL,
    color: colors.textMuted
  };
}

/** Standard transition for expand/collapse and interactive chrome. */
export function tradingRoomMotionTransition(...props: string[]): string {
  const ms = animationDurations.normal;
  const keys =
    props.length > 0 ? props : ["background", "border-color", "color", "box-shadow", "transform", "opacity"];
  return keys.map((p) => `${p} ${ms}ms ease`).join(", ");
}

/** Primary column shell — surface step, no outer hairline. */
export function tradingRoomPanelStyle(colors: ThemeColors, padding: keyof typeof spacing = 5): CSSProperties {
  return {
    background: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing[padding]
  };
}

/** Recessed module inside a panel — top accent rail only. */
export function tradingRoomInsetTileStyle(
  colors: ThemeColors,
  accent: string,
  theme: "dark" | "light"
): CSSProperties {
  const insetBg = theme === "dark" ? "rgba(255,255,255,0.022)" : "rgba(2,6,23,0.022)";
  return {
    background: insetBg,
    border: "none",
    borderTop: `2px solid ${accent}`,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    boxShadow: `inset 0 1px 0 ${colors.border}40`
  };
}

/** Desk / watchlist / quiet feed card — lane rail; active state via inset ring. */
export function tradingRoomFeedCardStyle(
  colors: ThemeColors,
  opts: { active: boolean; railAccent: string }
): CSSProperties {
  return {
    background: opts.active ? colors.surfaceMuted : colors.surface,
    border: "none",
    borderLeft: `3px solid ${opts.railAccent}`,
    borderRadius: borderRadius.md,
    boxShadow: opts.active
      ? `inset 0 0 0 1px ${colors.accent}55`
      : `inset 0 0 0 1px ${colors.border}40`,
    transition: tradingRoomMotionTransition("background", "box-shadow")
  };
}

/** Segmented control track — recessed pill rail. */
export function tradingRoomSegTrackStyle(colors: ThemeColors): CSSProperties {
  return {
    display: "flex",
    gap: 4,
    padding: 3,
    background: colors.surfaceMuted,
    border: "none",
    borderRadius: borderRadius.full,
    boxShadow: `inset 0 0 0 1px ${colors.border}50`
  };
}

/** Decision / evidence blocks in Deep Dive. */
export function tradingRoomEvidenceShellStyle(colors: ThemeColors): CSSProperties {
  return {
    background: colors.surfaceMuted,
    border: "none",
    borderRadius: borderRadius.lg,
    padding: `${spacing[3]} ${spacing[4]}`,
    boxShadow: `inset 0 0 0 1px ${colors.border}40`
  };
}

/** Secondary body copy ladder (xs muted). */
export function tradingRoomMetaTextStyle(colors: ThemeColors): CSSProperties {
  return {
    fontSize: typography.scale.xs,
    color: colors.textMuted,
    lineHeight: 1.45
  };
}
