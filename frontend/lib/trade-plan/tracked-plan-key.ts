import type { TrackedPlanMode } from "@/lib/trade-plan/types";

/** Max tracked plans kept per user (mirrors backend MAX_TRACKED_PLANS_PER_USER). */
export const MAX_TRACKED_PLANS = 24;

export function trackedPlanKey(symbol: string, mode: TrackedPlanMode): string {
  return `${mode}:${symbol.trim().toUpperCase()}`;
}

export function feedCardTrackedPlanKey(card: { symbol: string; lane: string }): string {
  const mode: TrackedPlanMode = card.lane === "day" ? "day" : "swing";
  return trackedPlanKey(card.symbol, mode);
}
