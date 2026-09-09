"use client";

import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type {
  PositionFundamentalsSummary,
  PositionThesisPacket
} from "@/lib/dashboard/trading-room/position-fundamentals-present";
import { PositionFundamentalsGrid } from "@/components/dashboard/trading-room/position-fundamentals-grid";
import { PositionInvestmentRead } from "@/components/dashboard/trading-room/position-investment-read";
import { PositionResearchPanel } from "@/components/dashboard/trading-room/position-research-panel";
import type { SignalsSetupBias } from "@/lib/signals-page-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  symbol: string;
  bias: SignalsSetupBias;
  fundamentals: PositionFundamentalsSummary;
  thesisPacket?: PositionThesisPacket | null;
  signalBasisLabel?: string | null;
  layerAlignmentLine?: string | null;
  signalValidDays?: number | null;
  colors: Colors;
};

function biasColor(bias: SignalsSetupBias, colors: Colors): string {
  if (bias === "Bullish") return colors.bullish;
  if (bias === "Bearish") return colors.bearish;
  return colors.caution;
}

export function PositionSetupRead({
  symbol,
  bias,
  fundamentals,
  thesisPacket,
  signalBasisLabel,
  layerAlignmentLine,
  signalValidDays,
  colors
}: Props) {
  const aggScore = fundamentals.score != null ? `${fundamentals.score}/100` : "—";
  const weakest = fundamentals.weakestPillarId
    ? fundamentals.pillars.find((p) => p.pillarId === fundamentals.weakestPillarId)
    : null;

  return (
    <article
      data-testid="position-setup-read"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[4]
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Investment read
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[2], marginTop: spacing[2] }}>
          <span style={{ fontSize: typography.scale.lg, fontWeight: 700, color: biasColor(bias, colors) }}>
            {bias} · {aggScore} fundamentals
          </span>
          {signalValidDays != null && signalValidDays > 0 ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
              Valid ~{signalValidDays} days (weekly structure)
            </span>
          ) : null}
        </div>
        {signalBasisLabel ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
            {signalBasisLabel}
          </p>
        ) : null}
        {fundamentals.reasoning ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
            {fundamentals.reasoning}
          </p>
        ) : null}
        {layerAlignmentLine ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            {layerAlignmentLine}
          </p>
        ) : null}
        {weakest ? (
          <p
            data-testid="position-weakest-pillar"
            style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.caution, fontWeight: 600 }}
          >
            Weakest pillar: {weakest.label} ({weakest.pillarId})
          </p>
        ) : null}
      </div>

      <PositionFundamentalsGrid summary={fundamentals} colors={colors} />

      {thesisPacket ? (
        <PositionInvestmentRead symbol={symbol} packet={thesisPacket} colors={colors} />
      ) : null}

      {/* ADR-004 POS-AI-4 — external Research (renders only when the flag is on). */}
      <PositionResearchPanel symbol={symbol} colors={colors} />

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
        Glass-box fundamentals for {symbol} — pillar scores and the thesis are informational only,
        not buy/sell instructions.
      </p>
      <SignalDisclaimerChip />
    </article>
  );
}
