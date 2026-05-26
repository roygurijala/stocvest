"use client";

import Link from "next/link";
import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";

export function TrialUpgradeWall() {
  const { colors } = useTheme();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-upgrade-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        placeItems: "center",
        padding: spacing[4],
        background: "rgba(5, 8, 16, 0.88)",
        backdropFilter: "blur(6px)"
      }}
    >
      <div
        style={{
          width: "min(100%, 440px)",
          padding: spacing[6],
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)"
        }}
      >
        <h2
          id="trial-upgrade-title"
          style={{ margin: 0, color: colors.text, fontSize: typography.scale.xl, fontWeight: 700 }}
        >
          Your trial has ended
        </h2>
        <p style={{ marginTop: spacing[3], color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
          Upgrade to Swing Pro or Swing + Day Pro to keep full access to signals, scanner, watchlists, and AI
          explanations.
        </p>
        <div style={{ display: "grid", gap: spacing[3], marginTop: spacing[5] }}>
          <Link
            href="/pricing"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              borderRadius: borderRadius.md,
              background: colors.accent,
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none"
            }}
          >
            View plans & upgrade
          </Link>
          <Link
            href="/dashboard/settings"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 40,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              fontWeight: 500,
              textDecoration: "none",
              fontSize: typography.scale.sm
            }}
          >
            Account settings
          </Link>
        </div>
      </div>
    </div>
  );
}
