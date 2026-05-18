"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  synthesis: ScannerSynthesis;
};

function conditionBadgeColor(condition: string, colors: ReturnType<typeof useTheme>["colors"]): string {
  const c = condition.toLowerCase();
  if (c.includes("low")) return "#d97706";
  if (c.includes("below")) return colors.textMuted;
  if (c.includes("normal") || c.includes("high")) return "#16a34a";
  return colors.accent;
}

function timeOfDayHint(timeOfDay: string): string {
  switch (timeOfDay) {
    case "early":
      return "Session just started — check back after 10:30 AM ET.";
    case "late":
      return "Afternoon — recovery window may still open.";
    default:
      return "Mid-session — participation may recover in the afternoon.";
  }
}

export function MarketConditionsCard({ synthesis }: Props) {
  const { colors } = useTheme();
  const vc = synthesis.volume_context;
  const condition = vc?.market_condition ?? "Normal";
  const badgeColor = conditionBadgeColor(condition, colors);

  return (
    <section
      data-testid="scanner-market-conditions"
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
        Market conditions
        {synthesis.session_time_et ? (
          <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            {" "}
            · {synthesis.session_time_et} ET
          </span>
        ) : null}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[2],
          marginBottom: spacing[3]
        }}
      >
        <span
          data-testid="scanner-market-condition-badge"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: `${spacing[1]} ${spacing[2]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${badgeColor}`,
            color: badgeColor
          }}
        >
          {condition}
        </span>
      </div>
      <p
        data-testid="scanner-market-summary"
        style={{
          margin: `0 0 ${spacing[3]}`,
          fontSize: typography.scale.sm,
          color: colors.text,
          lineHeight: 1.55
        }}
      >
        {synthesis.market_summary}
      </p>
      {vc ? (
        <p
          data-testid="scanner-volume-pace-hint"
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          Broad volume is running below expected intraday pace for this time of day.{" "}
          {timeOfDayHint(vc.time_of_day)}
        </p>
      ) : null}
    </section>
  );
}
