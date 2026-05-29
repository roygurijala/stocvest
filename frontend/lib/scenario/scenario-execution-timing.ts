/**
 * Execution timing flags for scenario verdict — structure vs timing separation.
 */

import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

export type ScenarioExecutionTiming = {
  entryTimingWeak?: boolean;
  vwapConflict?: boolean;
};

export function detectExecutionTimingFlags(
  systemDecision: TradeDecision | null | undefined
): ScenarioExecutionTiming {
  if (!systemDecision) return {};
  const parts = [
    systemDecision.line,
    ...(systemDecision.reinforcements ?? []),
    systemDecision.rationale?.text ?? ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    entryTimingWeak: /weak entry timing/.test(parts),
    vwapConflict: /vwap conflict/.test(parts)
  };
}

export function hasWeakExecutionTiming(
  timing: ScenarioExecutionTiming | null | undefined,
  systemDecision?: TradeDecision | null
): boolean {
  const detected = detectExecutionTimingFlags(systemDecision);
  return Boolean(
    timing?.entryTimingWeak ||
      timing?.vwapConflict ||
      detected.entryTimingWeak ||
      detected.vwapConflict
  );
}

export function weakExecutionTimingDetail(
  timing: ScenarioExecutionTiming | null | undefined,
  systemDecision?: TradeDecision | null
): string | null {
  const detected = detectExecutionTimingFlags(systemDecision);
  const weak = timing?.entryTimingWeak ?? detected.entryTimingWeak;
  const vwap = timing?.vwapConflict ?? detected.vwapConflict;
  if (weak && vwap) {
    return "Weak entry timing and VWAP conflict — wait for reclaim or use a dip preset.";
  }
  if (vwap) return "VWAP conflict — price below VWAP; long timing is suboptimal until reclaimed.";
  if (weak) return "Weak entry timing — structure may be valid but execution odds are lower.";
  return null;
}
