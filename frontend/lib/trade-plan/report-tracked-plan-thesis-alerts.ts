import type { ThesisStatus } from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";

const STORAGE_KEY = "stocvest:plan-thesis-last-seen:v1";

type StoredThesisMap = Record<string, ThesisStatus>;

function thesisRank(status: ThesisStatus): number {
  if (status === "invalid") return 2;
  if (status === "weakened") return 1;
  return 0;
}

function readStored(): StoredThesisMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StoredThesisMap;
  } catch {
    return {};
  }
}

function writeStored(map: StoredThesisMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export type ThesisAlertAssessment = {
  planId: string;
  symbol: string;
  mode: TrackedPlan["mode"];
  previousStatus: ThesisStatus;
  thesisStatus: ThesisStatus;
  thesisLabel: string;
  thesisHint: string;
  triggerLabel: string;
};

/** Detect thesis transitions worth emailing; bootstrap first observation without alert. */
export function collectThesisTransitionAlerts(
  plans: TrackedPlan[],
  diffByPlanId: Map<string, { thesis: { status: ThesisStatus; label: string; hint: string }; trigger: { label: string } }>
): ThesisAlertAssessment[] {
  const stored = readStored();
  const out: ThesisAlertAssessment[] = [];
  const next: StoredThesisMap = { ...stored };

  for (const plan of plans) {
    const diff = diffByPlanId.get(plan.id);
    if (!diff) continue;
    const status = diff.thesis.status;
    next[plan.id] = status;

    if (!(plan.id in stored)) {
      continue;
    }
    const prev = stored[plan.id] ?? "valid";
    if (thesisRank(status) <= thesisRank(prev)) {
      continue;
    }
    if (status !== "weakened" && status !== "invalid") {
      continue;
    }
    out.push({
      planId: plan.id,
      symbol: plan.symbol,
      mode: plan.mode,
      previousStatus: prev,
      thesisStatus: status,
      thesisLabel: diff.thesis.label,
      thesisHint: diff.thesis.hint,
      triggerLabel: diff.trigger.label
    });
  }

  writeStored(next);
  return out;
}

export function clearThesisSeenForPlan(planId: string): void {
  const stored = readStored();
  if (!(planId in stored)) return;
  delete stored[planId];
  writeStored(stored);
}
