"use client";

import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { environmentTierLabel } from "@/lib/market-environment/policy";
import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  environment: MarketEnvironmentPayload | null;
  testId?: string;
};

function tierColor(tier: MarketEnvironmentPayload["environment_tier"], colors: ReturnType<typeof useTheme>["colors"]) {
  if (tier === "crisis" || tier === "stressed") return colors.caution;
  if (tier === "elevated") return colors.caution;
  return colors.bullish;
}

/** Compact Layer 0 strip for scanner / watchlist desk headers. */
export function MarketEnvironmentStrip({ environment, testId = "market-environment-strip" }: Props) {
  const { colors } = useTheme();
  if (!environment) return null;

  const color = tierColor(environment.environment_tier, colors);
  const newAllowed =
    environment.mode === "day" ? environment.new_day_allowed : environment.new_swing_allowed;
  const hysteresis =
    environment.hysteresis_applied &&
    environment.environment_tier_raw &&
    environment.environment_tier_raw !== environment.environment_tier;

  return (
    <div
      data-testid={testId}
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted,
        padding: `${spacing[2]} ${spacing[3]}`
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
          ENVIRONMENT
        </span>
        <span
          data-testid={`${testId}-tier`}
          style={{ fontSize: typography.scale.xs, fontWeight: 700, color }}
        >
          {environmentTierLabel(environment.environment_tier)}
          {environment.vix_level != null ? ` · VIX ${environment.vix_level.toFixed(1)}` : ""}
        </span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          {newAllowed
            ? `New ${environment.mode} entries OK · min R/R ${environment.min_rr.toFixed(1)}:1`
            : `New ${environment.mode} entries paused`}
        </span>
        {hysteresis ? (
          <span
            data-testid={`${testId}-hysteresis`}
            style={{ fontSize: typography.scale.xs, color: colors.textMuted }}
          >
            (held above {environment.environment_tier_raw})
          </span>
        ) : null}
        <InfoTip
          text={environment.headline}
          label="Market environment policy"
          maxWidth={360}
        />
      </div>
    </div>
  );
}
