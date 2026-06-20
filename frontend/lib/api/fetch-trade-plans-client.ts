import type { TrackedPlan } from "@/lib/trade-plan/types";

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchTradePlansClient(): Promise<TrackedPlan[]> {
  const res = await fetch("/api/stocvest/trade-plans", { method: "GET", cache: "no-store" }).catch(() => null);
  if (!res?.ok) return [];
  return (await parseJson<TrackedPlan[]>(res)) ?? [];
}

export async function upsertTradePlanClient(plan: TrackedPlan): Promise<TrackedPlan | null> {
  const res = await fetch("/api/stocvest/trade-plans", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return null;
  return parseJson<TrackedPlan>(res);
}

export async function syncTradePlansClient(plans: TrackedPlan[]): Promise<TrackedPlan[]> {
  const res = await fetch("/api/stocvest/trade-plans/sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plans }),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return [];
  return (await parseJson<TrackedPlan[]>(res)) ?? [];
}

export async function deleteTradePlanClient(planId: string): Promise<boolean> {
  const res = await fetch(`/api/stocvest/trade-plans/${encodeURIComponent(planId)}`, {
    method: "DELETE",
    cache: "no-store"
  }).catch(() => null);
  return Boolean(res?.ok);
}

export async function reportTrackedPlanThesisAlertsClient(
  assessments: Array<{
    planId: string;
    symbol: string;
    mode: string;
    previousStatus: string;
    thesisStatus: string;
    thesisLabel: string;
    thesisHint: string;
    triggerLabel: string;
  }>
): Promise<number> {
  if (assessments.length === 0) return 0;
  const res = await fetch("/api/stocvest/trade-plans/thesis-alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assessments }),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return 0;
  const body = (await res.json().catch(() => null)) as { sent?: number } | null;
  return typeof body?.sent === "number" ? body.sent : 0;
}
