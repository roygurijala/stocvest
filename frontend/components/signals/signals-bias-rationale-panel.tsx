"use client";

import { SignalsLayerForceSummary } from "@/components/signals/signals-layer-force-summary";
import {
  buildBiasRationaleIntro,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  signalSummary: string;
};

export function SignalsBiasRationalePanel({ bias, rows, signalSummary }: Props) {
  const { colors } = useTheme();
  const intro = buildBiasRationaleIntro(bias, rows, signalSummary);
  const biasColor =
    bias === "Bullish" ? colors.bullish : bias === "Bearish" ? colors.bearish : colors.caution;

  return (
    <article
      id={SIGNALS_SECTION_TARGET.biasRationale}
      className={`scroll-mt-4 ${surfaceGlowClassName}`}
      data-testid="signals-bias-rationale"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <h3 className="m-0 text-base font-semibold" style={{ color: colors.text }}>
        Why this bias?
      </h3>
      <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
        How the six layers reconcile into a desk read — informational only
      </p>
      <p className="m-0 mt-3 text-sm leading-snug" style={{ color: colors.text }}>
        <span className="font-semibold" style={{ color: biasColor }}>
          {bias}
        </span>
        {" — "}
        {intro}
      </p>
      <SignalsLayerForceSummary rows={rows} bias={bias} />
    </article>
  );
}
