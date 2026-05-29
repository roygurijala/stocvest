"use client";

import { SignalsLayerForceSummary } from "@/components/signals/signals-layer-force-summary";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { evidenceLayersToRows, pickPrimaryLayerDrivers } from "@/lib/signal-evidence/evidence-card-present";
import type { EvidenceLayer } from "@/lib/signal-evidence";
import type { SignalsSetupBias } from "@/lib/signals-page-present";

function elevatedCardStyle(colors: ThemeColors) {
  return {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    boxShadow: "0 1px 0 rgba(255,255,255,0.04)"
  };
}

type Props = {
  layers: EvidenceLayer[];
  bias: SignalsSetupBias;
};

/**
 * Evidence-only layer summary — verdicts and drivers, no 0–100 layer scores.
 * (Numeric scores remain on the Signals desk / Layers tab for power users.)
 */
export function EvidenceLayerContribution({ layers, bias }: Props) {
  const { colors } = useTheme();
  const primary = pickPrimaryLayerDrivers(layers, bias);
  const rows = evidenceLayersToRows(layers);

  return (
    <section
      data-testid="evidence-layer-contribution"
      style={{
        borderRadius: borderRadius.lg,
        padding: spacing[3],
        display: "grid",
        gap: spacing[2],
        ...elevatedCardStyle(colors)
      }}
    >
      <div>
        <h3 className="m-0" style={{ fontSize: typography.scale.lg }}>
          Layer read (by verdict)
        </h3>
        <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
          How each layer lines up with today&apos;s bias — verdict only, not internal layer scores or trade readiness.
        </p>
      </div>
      <SignalsLayerForceSummary rows={rows} bias={bias} showLevelFootnote={false} />
      {primary.length > 0 ? (
        <p className="m-0 text-sm" style={{ color: colors.text }} data-testid="evidence-primary-drivers">
          <span style={{ fontWeight: 600 }}>Primary drivers: </span>
          {primary.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
