import { mergeTrackedPlans } from "@/lib/trade-plan/tracked-plan-merge";
import { MAX_TRACKED_PLANS, trackedPlanKey } from "@/lib/trade-plan/tracked-plan-key";
import type { TrackedPlan, TrackedPlanMode } from "@/lib/trade-plan/types";

const STORAGE_KEY = "stocvest:tracked-plans:v1";

function planKey(symbol: string, mode: TrackedPlanMode): string {
  return trackedPlanKey(symbol, mode);
}

function readAll(): TrackedPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrackedPlan);
  } catch {
    return [];
  }
}

function writeAll(plans: TrackedPlan[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans.slice(0, MAX_TRACKED_PLANS)));
}

/** Replace all local plans (used by server sync merge). */
export function writeAllTrackedPlans(plans: TrackedPlan[]): void {
  writeAll(plans);
  notifyTrackedPlanUpdated();
}

export function isTrackedPlan(v: unknown): v is TrackedPlan {
  if (!v || typeof v !== "object") return false;
  const p = v as TrackedPlan;
  return (
    typeof p.id === "string" &&
    typeof p.symbol === "string" &&
    (p.mode === "swing" || p.mode === "day") &&
    typeof p.committedAt === "string" &&
    p.levels != null &&
    typeof p.levels.entryLow === "number" &&
    typeof p.levels.entryHigh === "number" &&
    typeof p.levels.stop === "number" &&
    typeof p.levels.target1 === "number" &&
    typeof p.levels.priceAtCommit === "number"
  );
}

export function listTrackedPlans(): TrackedPlan[] {
  return readAll().sort((a, b) => Date.parse(b.committedAt) - Date.parse(a.committedAt));
}

export function getTrackedPlan(symbol: string, mode: TrackedPlanMode): TrackedPlan | null {
  const key = planKey(symbol, mode);
  return readAll().find((p) => planKey(p.symbol, p.mode) === key) ?? null;
}

export function saveTrackedPlan(plan: TrackedPlan): TrackedPlan {
  const key = planKey(plan.symbol, plan.mode);
  const rest = readAll().filter((p) => planKey(p.symbol, p.mode) !== key);
  const next = [plan, ...rest].slice(0, MAX_TRACKED_PLANS);
  writeAll(next);
  notifyTrackedPlanUpdated();
  return plan;
}

export function removeTrackedPlan(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
  notifyTrackedPlanUpdated();
}

export function removeTrackedPlanForSymbol(symbol: string, mode: TrackedPlanMode): void {
  const key = planKey(symbol, mode);
  writeAll(readAll().filter((p) => planKey(p.symbol, p.mode) !== key));
  notifyTrackedPlanUpdated();
}

export const TRACKED_PLAN_UPDATED_EVENT = "stocvest:tracked-plan-updated";

export function notifyTrackedPlanUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TRACKED_PLAN_UPDATED_EVENT));
}

export function exportTrackedPlansJson(): string {
  return JSON.stringify(listTrackedPlans(), null, 2);
}

export function importTrackedPlansJson(raw: string): { imported: number; error?: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { imported: 0, error: "Expected a JSON array of plans." };
    const valid = parsed.filter(isTrackedPlan);
    if (valid.length === 0) return { imported: 0, error: "No valid plans found in file." };
    // Newest commit wins per symbol+mode — consistent with server/local merge.
    writeAll(mergeTrackedPlans(listTrackedPlans(), valid));
    notifyTrackedPlanUpdated();
    return { imported: valid.length };
  } catch {
    return { imported: 0, error: "Invalid JSON." };
  }
}
