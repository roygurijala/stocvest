"use client";

import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { trialCountdownLabel } from "@/lib/trial-access";
import type { UserMePayload } from "@/lib/api/contracts";

export function TrialSidebarPill({ profile }: { profile: UserMePayload | null }) {
  const { colors } = useTheme();
  const label = trialCountdownLabel(profile);
  if (!label) return null;

  return (
    <div
      data-testid="trial-sidebar-pill"
      style={{
        marginBottom: spacing[2],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid rgba(34, 197, 94, 0.35)`,
        background: "rgba(34, 197, 94, 0.1)",
        color: colors.bullish,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        textAlign: "center",
        lineHeight: 1.35
      }}
    >
      {label}
    </div>
  );
}
