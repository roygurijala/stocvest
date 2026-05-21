"use client";

import { Check, Circle } from "lucide-react";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import { buildWhyNotBullets, type SignalsLayerRowInput, type SignalsSetupBias } from "@/lib/signals-page-present";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  decision: TradeDecision;
  previewLayers: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  maxBullets?: number;
};

export function SignalsWhyNotPanel({
  decision,
  previewLayers,
  bias,
  maxBullets = 5
}: Props) {
  const { colors } = useTheme();
  const bullets =
    decision.state === "actionable" ? [] : buildWhyNotBullets(decision, previewLayers, bias, maxBullets);

  if (bullets.length === 0) return null;

  return (
    <article
      className={surfaceGlowClassName}
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
        Gates still open — informational only
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
