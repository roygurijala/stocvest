"use client";

import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { environmentTierLabel } from "@/lib/signal-evidence/market-environment-present";
import type { LedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import type { PlanningGatesPayload } from "@/lib/signal-evidence/planning-gates-present";
import {
  buildRiskStackSummary,
  riskStackStatusColor,
  type RiskStackRow
} from "@/lib/signal-evidence/risk-stack-present";
import type { SignalEvidenceInsight } from "@/lib/signal-evidence";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  environment: MarketEnvironmentPayload;
  signalState: TradeDecisionState;
  insight?: SignalEvidenceInsight | null;
  planningGates?: PlanningGatesPayload | null;
  ledgerGates?: LedgerGateSummary | null;
  testId?: string;
};

function StatusDot({ status, colors }: { status: RiskStackRow["status"]; colors: ReturnType<typeof useTheme>["colors"] }) {
  const tone = riskStackStatusColor(status);
  const color = tone === "bullish" ? colors.bullish : tone === "caution" ? colors.caution : colors.bearish;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0
      }}
    />
  );
}

function StackRow({
  row,
  testId,
  colors
}: {
  row: RiskStackRow;
  testId: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <li data-testid={`${testId}-${row.layer}`} className="flex gap-2">
      <StatusDot status={row.status} colors={colors} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold" style={{ color: colors.text }}>
          {row.label}
        </span>
        {" — "}
        <span style={{ color: colors.textMuted }}>{row.summary}</span>
        {row.detail ? (
          <p className="m-0 mt-0.5 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
            {row.detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function RiskStackPanel({
  environment,
  signalState,
  insight = null,
  planningGates,
  ledgerGates,
  testId = "signal-evidence-risk-stack"
}: Props) {
  const { colors } = useTheme();
  const tierColorValue =
    environment.environment_tier === "crisis" || environment.environment_tier === "stressed"
      ? colors.caution
      : environment.environment_tier === "elevated"
        ? colors.caution
        : colors.bullish;

  const stack = buildRiskStackSummary({
    environment,
    signalState,
    insight,
    ledgerGates: ledgerGates ?? null
  });

  return (
    <section
      data-testid={testId}
      style={{
        marginTop: spacing[3],
        marginBottom: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>
          RISK STACK
        </span>
        <span
          data-testid={`${testId}-tier`}
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            color: tierColorValue
          }}
        >
          {environmentTierLabel(environment.environment_tier)}
          {environment.vix_level != null ? ` · VIX ${environment.vix_level.toFixed(1)}` : null}
        </span>
      </div>

      {stack.decouplingMessage ? (
        <p
          data-testid={`${testId}-decoupling`}
          className="m-0 mt-2 text-xs leading-relaxed"
          style={{ color: colors.caution, fontWeight: 600 }}
        >
          {stack.decouplingMessage}
        </p>
      ) : null}

      <ul className="m-0 mt-2 list-none space-y-2 p-0 text-xs" style={{ color: colors.textMuted }}>
        {stack.rows.map((row) => (
          <StackRow key={row.layer} row={row} testId={testId} colors={colors} />
        ))}
      </ul>

      {planningGates ? (
        <p className="m-0 mt-2 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          Planning checklist below uses desk min R/R {planningGates.min_rr_desk?.toFixed(1) ?? environment.min_rr.toFixed(1)} : 1
          {planningGates.environment_tier ? ` (${planningGates.environment_tier} tier).` : "."}
        </p>
      ) : null}
    </section>
  );
}
