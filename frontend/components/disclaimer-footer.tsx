"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export function DisclaimerFooter() {
  const { colors } = useTheme();
  return (
    <footer
      className="mt-auto px-4 py-4 lg:px-6"
      style={{
        borderTop: `1px solid ${colors.border}`,
        background: colors.surface,
        color: colors.textMuted,
        fontSize: typography.scale.xs,
        lineHeight: 1.5,
        borderRadius: `${borderRadius.none}`
      }}
    >
      STOCVEST signals are for informational purposes only and do not constitute investment advice. You are solely
      responsible for all trading decisions. Past signal performance does not guarantee future results.
    </footer>
  );
}
