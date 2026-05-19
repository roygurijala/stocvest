"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: ScannerScanSummary;
  /** Quiet scan — emphasize desk counts (hero omits duplicate total). */
  emphasized?: boolean;
};

export function ScannerOutcomeCards({ summary, emphasized = false }: Props) {
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
              padding: emphasized ? spacing[4] : spacing[3],
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              background: emphasized ? colors.surface : colors.surfaceMuted,
              borderTop: `3px solid ${accent.borderAccent}`,
              boxShadow: emphasized
                ? `0 1px 0 color-mix(in srgb, ${accent.borderAccent} 25%, transparent)`
                : undefined
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: emphasized ? typography.scale.lg : typography.scale.base,
                fontWeight: 700,
                color: colors.text,
                lineHeight: 1.2
              }}
            >
              {card.label}: {card.count}
            </p>
          </div>
        );
      })}
    </div>
  );
}
