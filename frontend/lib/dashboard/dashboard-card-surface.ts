/**
 * Shared direction chrome for dashboard opportunity cards — neutral surface,
 * thick left/bottom accents keyed to session direction.
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

  return {
    background: colors.surface,
    border: colors.border,
    borderLeft: accent,
    borderBottom: accent,
    accent
  };
}
