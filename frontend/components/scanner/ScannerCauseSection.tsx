"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  bullets: string[];
};

export function ScannerCauseSection({ bullets }: Props) {
  if (bullets.length === 0) return null;
  const { colors } = useTheme();

  return (
    <section
      data-testid="scanner-cause-section"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[2]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Why nothing passed
      </p>
      <ul
        style={{
          margin: 0,
          padding: `0 0 0 ${spacing[4]}`,
          display: "grid",
          gap: spacing[1],
          fontSize: typography.scale.sm,
          color: colors.text,
          lineHeight: 1.5
        }}
      >
        {bullets.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
