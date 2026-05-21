"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { MarketConditionsQuietCard } from "@/lib/scanner-quiet-copy";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: MarketConditionsQuietCard;
};

export function ScannerMarketConditionsCard({ model }: Props) {
  const { colors } = useTheme();

  const lineTone = (tone: "ok" | "caution" | "bearish") => {
    switch (tone) {
      case "ok":
        return colors.bullish;
      case "bearish":
        return colors.bearish;
      default:
        return colors.caution;
    }
  };

  const envWeak = model.environmentQuality.tone === "weak";
  const regimeColor = lineTone(model.regimeContextTone);

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

      <div style={{ display: "grid", gap: spacing[2] }}>
        <p
          data-testid="scanner-market-regime-context"
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: regimeColor,
            lineHeight: 1.55
          }}
        >
          {model.regimeContextLine}
        </p>
        <p
          data-testid="scanner-market-volume-blocker"
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.caution,
            lineHeight: 1.55
          }}
        >
          {model.volumeBlockerLine}
        </p>
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
