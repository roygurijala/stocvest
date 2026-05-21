"use client";

import { executionHeadline } from "@/lib/signals-page-present";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import { borderRadius } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  decisionState: TradeDecisionState;
  maturationLabel?: string | null;
};

export function SignalsFormingBanner({ decisionState, maturationLabel }: Props) {
  const { colors } = useTheme();
  if (decisionState === "actionable") return null;

  const headline = executionHeadline(decisionState);
  const accent =
    decisionState === "monitor"
      ? `color-mix(in srgb, ${colors.caution} 18%, ${colors.surfaceMuted})`
      : colors.surfaceMuted;

  return (
    <div
      className="rounded-xl border px-4 py-3"
      data-testid="signals-forming-banner"
      style={{
        background: accent,
        borderColor: colors.border,
        borderRadius: borderRadius.xl
      }}
    >
      <p className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
        {headline}
      </p>
      {maturationLabel ? (
        <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
          Watchlist maturation: {maturationLabel}
        </p>
      ) : null}
    </div>
  );
}
