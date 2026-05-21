"use client";

import { borderRadius, spacing } from "@/lib/design-system";
import type { TradeConvictionTierResult } from "@/lib/trade-conviction-tier";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  conviction: TradeConvictionTierResult;
  /** Show B+ disclosure expanded by default (usually false). */
  defaultOpenBPlus?: boolean;
};

function tierColors(tone: TradeConvictionTierResult["tone"], colors: ReturnType<typeof useTheme>["colors"]) {
  if (tone === "bullish") {
    return {
      fg: colors.bullish,
      bg: `color-mix(in srgb, ${colors.bullish} 12%, transparent)`,
      border: `color-mix(in srgb, ${colors.bullish} 40%, ${colors.border})`
    };
  }
  if (tone === "caution") {
    return {
      fg: colors.caution,
      bg: `color-mix(in srgb, ${colors.caution} 10%, transparent)`,
      border: `color-mix(in srgb, ${colors.caution} 35%, ${colors.border})`
    };
  }
  return {
    fg: colors.textMuted,
    bg: `color-mix(in srgb, ${colors.textMuted} 8%, transparent)`,
    border: colors.border
  };
}

export function ConvictionTierBadge({ conviction, defaultOpenBPlus = false }: Props) {
  const { colors } = useTheme();
  const palette = tierColors(conviction.tone, colors);

  return (
    <div
      className="mt-3"
      data-testid={`signals-conviction-tier-${conviction.tier}`}
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: palette.fg, border: `1px solid ${palette.border}` }}
          data-testid="signals-conviction-tier-label"
        >
          {conviction.shortLabel} · {conviction.label}
        </span>
        {conviction.isDefaultRecommendation ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Default recommendation band
          </span>
        ) : null}
      </div>
      <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.text }}>
        {conviction.summaryLine}
      </p>
      {conviction.scenarioBuilderNote ? (
        <p className="m-0 mt-2 text-xs leading-relaxed" style={{ color: colors.textMuted }} data-testid="signals-conviction-scenario-builder-note">
          {conviction.scenarioBuilderNote}
        </p>
      ) : null}
      {conviction.tier === "b_plus" && conviction.detailLine ? (
        <details className="mt-2" open={defaultOpenBPlus} data-testid="signals-conviction-b-plus-detail">
          <summary
            className="cursor-pointer text-xs font-semibold"
            style={{ color: colors.caution, listStylePosition: "outside" }}
          >
            Lower-tier opportunity (discretionary)
          </summary>
          <p className="m-0 mt-1.5 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
            {conviction.detailLine}
          </p>
        </details>
      ) : null}
    </div>
  );
}
