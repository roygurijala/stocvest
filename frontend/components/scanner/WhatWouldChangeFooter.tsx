"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  text: string;
};

export function WhatWouldChangeFooter({ text }: Props) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const { colors } = useTheme();

  return (
    <aside
      data-testid="scanner-what-would-change"
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[1]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        What would change this
      </p>
      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
        {trimmed}
      </p>
    </aside>
  );
}
