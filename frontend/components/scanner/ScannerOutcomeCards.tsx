"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
};

export function ScannerOutcomeCards({ summary }: Props) {
  const { colors, theme } = useTheme();
  const cards = [
    {
      key: "gap",
      label: "Gaps",
      count: summary.qualifying.gap_flags,
      role: "shared" as const
    },
    {
      key: "swing",
      label: "Swing",
      count: summary.qualifying.swing,
      role: "swing" as const
    },
    {
      key: "day",
      label: "Day",
      count: summary.qualifying.day,
      role: "day" as const
    }
  ];

  return (
    <div
      data-testid="scanner-outcome-cards"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: spacing[2]
      }}
    >
      {cards.map((card) => {
        const accent = roleAccents[theme][card.role];
        return (
          <div
            key={card.key}
            data-testid={`scanner-outcome-card-${card.key}`}
            style={{
              padding: spacing[3],
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceMuted,
              borderTop: `3px solid ${accent.borderAccent}`
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              {card.label}
            </p>
            <p
              style={{
                margin: `${spacing[1]} 0 0`,
                fontSize: typography.scale.xl,
                fontWeight: 700,
                color: colors.text,
                lineHeight: 1.1
              }}
            >
              {card.count}
            </p>
            <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
              qualifying
            </p>
          </div>
        );
      })}
    </div>
  );
}
