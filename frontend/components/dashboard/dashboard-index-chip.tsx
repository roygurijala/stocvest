"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export type DashboardIndexChipTone = "bullish" | "bearish" | "muted";

type Props = {
  symbol: string;
  /** e.g. "Large cap" — shown after symbol when set */
  descriptor?: string;
  /** Short horizon badge: "today" | "5d" */
  horizon: "today" | "5d";
  formattedPct: string;
  tone: DashboardIndexChipTone;
  extra?: string;
  testId?: string;
};

function toneColor(tone: DashboardIndexChipTone, colors: ReturnType<typeof useTheme>["colors"]) {
  if (tone === "bullish") return colors.bullish;
  if (tone === "bearish") return colors.bearish;
  return colors.textMuted;
}

const HORIZON_LABEL: Record<Props["horizon"], string> = {
  today: "Today",
  "5d": "5d"
};

export function DashboardIndexChip({ symbol, descriptor, horizon, formattedPct, tone, extra, testId }: Props) {
  const { colors } = useTheme();
  const pctColor = toneColor(tone, colors);

  return (
    <div
      data-testid={testId}
      className="h-full w-full"
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        padding: `${spacing[2]} ${spacing[3]}`,
        minWidth: 0,
        background: `color-mix(in srgb, ${colors.surfaceMuted} 96%, ${pctColor} 4%)`
      }}
    >
      <div className="flex flex-wrap items-baseline gap-1">
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}>{symbol}</span>
        {descriptor ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 500 }}>{descriptor}</span>
        ) : null}
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: colors.textMuted,
            opacity: 0.9
          }}
        >
          · {HORIZON_LABEL[horizon]}
        </span>
      </div>
      <div
        style={{
          fontSize: typography.scale.sm,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: pctColor
        }}
      >
        {formattedPct}
      </div>
      {extra ? <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{extra}</div> : null}
    </div>
  );
}
