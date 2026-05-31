"use client";

import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { environmentTierLabel } from "@/lib/market-environment/policy";
import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  swing: MarketEnvironmentPayload | null;
  day?: MarketEnvironmentPayload | null;
  activeMode: "day" | "swing";
  showDay?: boolean;
};

function tierColor(tier: MarketEnvironmentPayload["environment_tier"], colors: ReturnType<typeof useTheme>["colors"]) {
  if (tier === "crisis" || tier === "stressed") return colors.caution;
  if (tier === "elevated") return colors.caution;
  return colors.bullish;
}

export function DashboardEnvironmentBanner({ swing, day, activeMode, showDay = true }: Props) {
  const { colors } = useTheme();
  const active = activeMode === "day" && day ? day : swing;
  if (!active) return null;

  const other = activeMode === "day" ? swing : day;
  const color = tierColor(active.environment_tier, colors);

  return (
    <div
      data-testid="dashboard-environment-banner"
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            color: colors.textMuted,
            letterSpacing: "0.04em"
          }}
        >
          MARKET ENVIRONMENT
        </span>
        <span
          data-testid="dashboard-environment-tier"
          style={{ fontSize: typography.scale.sm, fontWeight: 700, color }}
        >
          {environmentTierLabel(active.environment_tier)}
          {active.vix_level != null ? ` · VIX ${active.vix_level.toFixed(1)}` : ""}
        </span>
        <InfoTip
          text="Layer 0 desk policy from VIX tier: controls validation ledger gates and T2 target suppression. Stops still use structure + ATR only."
          label="About market environment"
          maxWidth={340}
        />
      </div>
      <p className="m-0 mt-1.5 text-xs leading-relaxed" style={{ color: colors.text }}>
        {active.headline}
      </p>
      {showDay && other && other.environment_tier !== active.environment_tier ? (
        <p className="m-0 mt-1 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          {activeMode === "day" ? "Swing" : "Day"} desk: {other.headline}
        </p>
      ) : null}
    </div>
  );
}
