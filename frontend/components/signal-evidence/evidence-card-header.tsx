"use client";

import type { ReactNode } from "react";
import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import {
  buildEvidenceAnchorLine,
  countLayerAlignment,
  formatDriversStrip,
  pickLeadingLayers,
  pickMissingConfirmationLayers
} from "@/lib/signal-evidence/evidence-card-present";
import type { SignalsLayerRowInput, SignalsSetupBias } from "@/lib/signals-page-present";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  updatedLabel?: string | null;
  children?: ReactNode;
};

export function EvidenceCardHeader({ symbol, bias, rows, updatedLabel, children }: Props) {
  const { colors } = useTheme();
  const alignment = countLayerAlignment(rows, bias);
  const biasColor =
    bias === "Bullish" ? colors.bullish : bias === "Bearish" ? colors.bearish : colors.caution;
  const anchor = buildEvidenceAnchorLine(bias, alignment);
  const drivers = formatDriversStrip({
    aligned: alignment.aligned,
    total: alignment.total,
    leading: pickLeadingLayers(rows, bias, 2),
    missing: pickMissingConfirmationLayers(rows, bias, 2)
  });

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="evidence-card-header"
      style={{
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4],
        display: "grid",
        gap: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p
            className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: colors.textMuted }}
          >
            Evidence
          </p>
          <h2 className="m-0 mt-1 text-xl font-semibold sm:text-2xl" style={{ color: colors.text }}>
            {symbol.trim().toUpperCase()}
          </h2>
        </div>
        {updatedLabel ? (
          <span className="text-xs tabular-nums" style={{ color: colors.textMuted }}>
            {updatedLabel}
          </span>
        ) : null}
      </div>

      <div>
        <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
          Bias
        </p>
        <p
          className="m-0 mt-0.5 text-xl font-semibold"
          style={{ color: biasColor }}
          data-testid="evidence-card-bias"
        >
          {bias}
        </p>
        <p
          className="m-0 mt-1 text-xs"
          style={{ color: colors.textMuted }}
          data-testid="evidence-card-alignment-context"
        >
          Alignment {alignment.aligned}/{alignment.total} ({alignment.label}) — context only; setup validity is on
          Signals
        </p>
      </div>

      <p
        className="m-0 text-sm font-medium leading-snug"
        style={{ color: colors.text }}
        data-testid="evidence-card-anchor"
      >
        {anchor}
      </p>

      <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }} data-testid="evidence-card-drivers">
        {drivers}
      </p>

      {children}

      <div className="flex flex-wrap items-center gap-2">
        <InfoTip
          label="Informational only"
          text="This card explains what is driving the signal from layer data. It is not investment advice and does not instruct a trade. Setup validity and gates live on the Signals page."
          maxWidth={320}
        />
        <span className="text-xs" style={{ color: colors.textMuted }}>
          Informational only
        </span>
      </div>
    </section>
  );
}
