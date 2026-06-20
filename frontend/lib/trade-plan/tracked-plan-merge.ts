import type { TrackedPlan } from "@/lib/trade-plan/types";
import { MAX_TRACKED_PLANS, trackedPlanKey } from "@/lib/trade-plan/tracked-plan-key";

function planSortTime(plan: TrackedPlan): number {
  const t = Date.parse(plan.committedAt);
  return Number.isFinite(t) ? t : 0;
}

/** Merge local + server plans; per symbol+mode keep newest commit. */
export function mergeTrackedPlans(local: TrackedPlan[], server: TrackedPlan[]): TrackedPlan[] {
  const byKey = new Map<string, TrackedPlan>();
  for (const p of [...local, ...server]) {
    const key = trackedPlanKey(p.symbol, p.mode);
    const cur = byKey.get(key);
    if (!cur || planSortTime(p) >= planSortTime(cur)) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => planSortTime(b) - planSortTime(a))
    .slice(0, MAX_TRACKED_PLANS);
}
