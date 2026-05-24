"use client";

import { Check, Circle } from "lucide-react";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import {
  causalBulletsForWhyNot,
  resolveCausalNarrative,
  type CausalNarrative
} from "@/lib/signal-evidence/causal-narrative";
import { buildWhyNotBullets, type SignalsLayerRowInput, type SignalsSetupBias } from "@/lib/signals-page-present";
import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  decision: TradeDecision;
  previewLayers: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  maxBullets?: number;
  /** All layer rows for causal narrative (defaults to previewLayers). */
  allLayers?: SignalsLayerRowInput[];
  signalSummary?: string;
  causalNarrativeApi?: unknown;
  /** When the causal narrative panel is visible above, show gate bullets only (no duplicate layer story). */
  causalNarrativeShown?: boolean;
};

export function SignalsWhyNotPanel({
  decision,
  previewLayers,
  bias,
  maxBullets = 5,
  allLayers,
  signalSummary = "",
  causalNarrativeApi,
  causalNarrativeShown = false
}: Props) {
  const { colors } = useTheme();
  const narrative: CausalNarrative | null =
    decision.state === "actionable"
      ? null
      : resolveCausalNarrative({
          apiPayload: causalNarrativeApi,
          signalSummary: signalSummary || bias.toLowerCase(),
          rows: allLayers ?? previewLayers,
          executionNote: decision.rationale?.text ?? null
        });
  const causalFallback =
    !causalNarrativeShown && narrative ? causalBulletsForWhyNot(narrative, maxBullets) : null;
  const bullets =
    decision.state === "actionable"
      ? []
      : buildWhyNotBullets(decision, previewLayers, bias, maxBullets, causalFallback);

  if (bullets.length === 0) return null;

  return (
    <article
      id={SIGNALS_SECTION_TARGET.whyNotActionable}
      className={`scroll-mt-4 ${surfaceGlowClassName}`}
      data-testid="signals-why-not"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <h3 className="m-0 text-base font-semibold" style={{ color: colors.text }}>
        Why not actionable?
      </h3>
      <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
        {causalNarrativeShown
          ? "Risk, alignment, and confirmation thresholds — separate from the layer context above"
          : "Gates still open — informational only"}
      </p>
      <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
        {bullets.map((bullet, index) => (
          <li key={bullet.slice(0, 48)} className="flex items-start gap-2.5 text-sm leading-snug">
            {index === 0 ? (
              <Circle
                size={16}
                className="mt-0.5 shrink-0"
                style={{ color: colors.caution }}
                aria-hidden
              />
            ) : (
              <Check
                size={16}
                className="mt-0.5 shrink-0 opacity-40"
                style={{ color: colors.textMuted }}
                aria-hidden
              />
            )}
            <span style={{ color: colors.text }}>{bullet}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
