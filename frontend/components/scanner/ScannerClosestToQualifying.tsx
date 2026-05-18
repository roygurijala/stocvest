"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ClosestToQualifyingLine } from "@/lib/scanner-quiet-copy";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  lines: ClosestToQualifyingLine[];
};

export function ScannerClosestToQualifying({ lines }: Props) {
  if (lines.length === 0) return null;
  const { colors } = useTheme();

  return (
    <section
      data-testid="scanner-closest-to-qualifying"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
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
        Closest to qualifying
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
        {lines.map((row) => (
          <li
            key={row.symbol}
            data-testid={`scanner-closest-${row.symbol}`}
            style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}
          >
            <span className="font-mono font-semibold">{row.symbol}</span>
            <span style={{ color: colors.textMuted }}> — {row.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
