"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ClosestQualifyingGroup } from "@/lib/scanner-quiet-copy";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  groups: ClosestQualifyingGroup[];
};

export function ScannerClosestToQualifying({ groups }: Props) {
  if (groups.length === 0) return null;
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
          margin: `0 0 ${spacing[3]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Closest to qualifying
      </p>
      <div style={{ display: "grid", gap: spacing[3] }}>
        {groups.map((group) => (
          <div key={group.label} data-testid={`scanner-closest-group-${slugify(group.label)}`}>
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                color: colors.text
              }}
            >
              {group.label}
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[1] }}>
              {group.items.map((row) => (
                <li
                  key={`${group.label}-${row.symbol}`}
                  data-testid={`scanner-closest-${row.symbol}`}
                  style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}
                >
                  <span className="font-mono font-semibold">{row.symbol}</span>
                  <span style={{ color: colors.textMuted }}> — {row.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
