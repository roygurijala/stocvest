"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { MarketConditionsQuietCard } from "@/lib/scanner-quiet-copy";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: MarketConditionsQuietCard;
};

export function ScannerMarketConditionsCard({ model }: Props) {
  const { colors } = useTheme();

  const pillColor = (tone: "ok" | "caution" | "bearish" | "muted") => {
    switch (tone) {
      case "ok":
        return { border: colors.bullish, color: colors.bullish, bg: "rgba(34,197,94,0.08)" };
      case "bearish":
        return { border: colors.bearish, color: colors.bearish, bg: "rgba(239,68,68,0.08)" };
      case "caution":
        return { border: colors.caution, color: colors.caution, bg: "rgba(245,158,11,0.08)" };
      default:
        return { border: colors.border, color: colors.textMuted, bg: colors.surfaceMuted };
    }
  };

  const regimeStyle = pillColor(model.regimePill.tone);
  const breadthStyle = pillColor(model.breadthPill.tone);
  const envWeak = model.environmentQuality.tone === "weak";

  return (
    <section
      data-testid="scanner-market-conditions-card"
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
        Market conditions
      </p>
      <h3
        data-testid="scanner-market-conditions-headline"
        style={{
          margin: `0 0 ${spacing[3]}`,
          fontSize: typography.scale.lg,
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1.3
        }}
      >
        {model.headline}
      </h3>

      <p
        data-testid="scanner-market-environment-quality"
        style={{
          margin: `0 0 ${spacing[2]}`,
          fontSize: typography.scale.sm,
          fontWeight: 700,
          color: envWeak ? colors.caution : colors.textMuted
        }}
      >
        {model.environmentQuality.label}
      </p>
      <p
        data-testid="scanner-market-focus-hint"
        style={{
          margin: `0 0 ${spacing[3]}`,
          fontSize: typography.scale.xs,
          fontWeight: 600,
          color: colors.textMuted,
          lineHeight: 1.45
        }}
      >
        {model.focusHint}
      </p>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: spacing[3] }}>
        <StatusPill label={model.regimePill.label} style={regimeStyle} testId="scanner-market-regime-pill" />
        <StatusPill label={model.breadthPill.label} style={breadthStyle} testId="scanner-market-breadth-pill" />
      </div>

      <div style={{ display: "grid", gap: spacing[2] }}>
        {model.bodyParagraphs.map((para) => (
          <p
            key={para}
            style={{
              margin: 0,
              fontSize: typography.scale.sm,
              color: colors.textMuted,
              lineHeight: 1.55
            }}
          >
            {para}
          </p>
        ))}
      </div>

      {model.footnote ? (
        <p
          style={{
            margin: `${spacing[3]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {model.footnote}
        </p>
      ) : null}
    </section>
  );
}

function StatusPill({
  label,
  style,
  testId
}: {
  label: string;
  style: { border: string; color: string; bg: string };
  testId: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: `${spacing[1]} ${spacing[2]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${style.border}`,
        color: style.color,
        background: style.bg
      }}
    >
      {label}
    </span>
  );
}
