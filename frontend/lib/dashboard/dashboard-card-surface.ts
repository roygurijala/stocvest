/**
 * Shared direction-tinted chrome for dashboard opportunity cards.
 */

export type DashboardCardTone = "bullish" | "bearish" | "muted";

export type DashboardCardTheme = {
  surface: string;
  border: string;
  bullish: string;
  bearish: string;
  textMuted: string;
};

export type DashboardCardChrome = {
  background: string;
  border: string;
  borderLeft: string;
  borderBottom: string;
  accent: string;
};

export function dashboardDirectionCardChrome(
  tone: DashboardCardTone,
  colors: DashboardCardTheme
): DashboardCardChrome {
  const accent =
    tone === "bullish" ? colors.bullish : tone === "bearish" ? colors.bearish : colors.textMuted;
  const background =
    tone === "bullish"
      ? `color-mix(in srgb, ${colors.bullish} 16%, ${colors.surface})`
      : tone === "bearish"
        ? `color-mix(in srgb, ${colors.bearish} 16%, ${colors.surface})`
        : colors.surface;

  return {
    background,
    border: `color-mix(in srgb, ${accent} 38%, ${colors.border})`,
    borderLeft: accent,
    borderBottom: `color-mix(in srgb, ${accent} 58%, transparent)`,
    accent
  };
}
