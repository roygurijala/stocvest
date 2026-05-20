"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { marketConditionsRegimeBadge } from "@/lib/scanner/scanner-quiet-desk";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  regimeLabel: string;
  bullets: string[];
  footnote?: string;
};

export function ScannerQuietMarketBanner({ regimeLabel, bullets, footnote }: Props) {
  const { colors } = useTheme();
  const badge = marketConditionsRegimeBadge(regimeLabel);
  const bearish = regimeLabel.toLowerCase().includes("bear");

  return (
    <section
      data-testid="scanner-quiet-market-banner"
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
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Why the scanner is quiet
      </p>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: spacing[2] }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Market conditions
        </span>
        <span
          data-testid="scanner-quiet-regime-badge"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: `${spacing[1]} ${spacing[2]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${bearish ? colors.bearish : colors.caution}`,
            color: bearish ? colors.bearish : colors.caution,
            background: bearish ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)"
          }}
        >
          {badge}
        </span>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: spacing[2],
          fontSize: typography.scale.sm,
          color: colors.text,
          lineHeight: 1.55
        }}
      >
        {bullets.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {footnote ? (
        <p
          style={{
            margin: `${spacing[3]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {footnote}
        </p>
      ) : null}
      <Link
        href="/dashboard"
        className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold"
        style={{ color: colors.accent }}
      >
        ← Dashboard overview
      </Link>
    </section>
  );
}
