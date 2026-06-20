import type { TrackedPlanMode } from "@/lib/trade-plan/types";

/** Deep link into Trading Room deep dive for a tracked plan. */
export function dashboardDeepLinkForPlan(symbol: string, mode: TrackedPlanMode): string {
  const sym = symbol.trim().toUpperCase();
  const lane = mode === "day" ? "day" : "swing";
  return `/dashboard?symbol=${encodeURIComponent(sym)}&lane=${encodeURIComponent(lane)}&ref=trade-plans`;
}
