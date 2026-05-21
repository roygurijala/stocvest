"use client";

import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import { primaryExecutionBlockerLine } from "@/lib/signals-page-present";
import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  decision: TradeDecision;
  tradingMode: "day" | "swing";
};

export function SignalsExecutionContextStrip({ decision, tradingMode }: Props) {
  const { colors } = useTheme();
  if (decision.state === "actionable") return null;

  const blocker = primaryExecutionBlockerLine(decision);
  const min = minRiskRewardForVerdict(tradingMode);
  const line =
    blocker ??
    (decision.rationale?.category === "risk_reward"
      ? `Blocked: R/R below desk minimum (needs ≥ ${min.toFixed(1)} : 1)`
      : null);

  if (!line) return null;

  return (
    <p
      className="m-0 mt-2 text-xs leading-relaxed"
      data-testid="signals-execution-context-strip"
      style={{ color: colors.textMuted }}
    >
      <span style={{ color: colors.caution, fontWeight: 600 }}>Execution: </span>
      {line}
    </p>
  );
}
