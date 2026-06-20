"use client";

import { useEffect, useMemo, useState } from "react";
import { __internal_fetchSignalComposite } from "@/lib/hooks/use-signal-composite";
import { assessTrackedPlanFromComposite } from "@/lib/trade-plan/assess-tracked-plan-live";
import type { LiveVsPlanDiff } from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";
import { reportTrackedPlanThesisAlertsClient } from "@/lib/api/fetch-trade-plans-client";
import { collectThesisTransitionAlerts } from "@/lib/trade-plan/report-tracked-plan-thesis-alerts";

const MAX_CONCURRENT = 2;
const COMPOSITE_TTL_MS = 60_000;

type CompositeResult = Record<string, unknown> | null;
const compositeCache = new Map<string, { at: number; value: CompositeResult }>();
const compositeInFlight = new Map<string, Promise<CompositeResult>>();

/** Fetch a composite with a short TTL + in-flight dedupe shared across hook instances. */
async function fetchCompositeCached(symbol: string, mode: TrackedPlan["mode"]): Promise<CompositeResult> {
  const key = `${mode}:${symbol.trim().toUpperCase()}`;
  const now = Date.now();
  const hit = compositeCache.get(key);
  if (hit && now - hit.at < COMPOSITE_TTL_MS) return hit.value;
  const pending = compositeInFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const value = (await __internal_fetchSignalComposite(symbol, mode)) as CompositeResult;
      compositeCache.set(key, { at: Date.now(), value });
      return value;
    } finally {
      compositeInFlight.delete(key);
    }
  })();
  compositeInFlight.set(key, promise);
  return promise;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export function useTrackedPlansLiveAssessment(plans: TrackedPlan[]): {
  diffByPlanId: Map<string, LiveVsPlanDiff>;
  loading: boolean;
} {
  const [diffByPlanId, setDiffByPlanId] = useState<Map<string, LiveVsPlanDiff>>(new Map());
  const [loading, setLoading] = useState(false);
  const planKey = useMemo(
    () => plans.map((p) => `${p.id}:${p.committedAt}`).join("|"),
    [plans]
  );

  useEffect(() => {
    if (plans.length === 0) {
      setDiffByPlanId(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const pairs = await mapWithConcurrency(plans, MAX_CONCURRENT, async (plan) => {
        try {
          const composite = await fetchCompositeCached(plan.symbol, plan.mode);
          if (cancelled) return [plan.id, null] as const;
          return [plan.id, assessTrackedPlanFromComposite(plan, composite)] as const;
        } catch {
          return [plan.id, assessTrackedPlanFromComposite(plan, null)] as const;
        }
      });
      if (cancelled) return;
      const next = new Map<string, LiveVsPlanDiff>();
      for (const [id, diff] of pairs) {
        if (diff) next.set(id, diff);
      }
      setDiffByPlanId(next);
      setLoading(false);

      const transitions = collectThesisTransitionAlerts(plans, next);
      if (transitions.length > 0) {
        void reportTrackedPlanThesisAlertsClient(transitions);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Depend only on the content-stable planKey; `plans` is a fresh array reference
    // on every list refresh and would otherwise re-fetch + re-POST alerts each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  return { diffByPlanId, loading };
}

export function collectThesisAlerts(
  plans: TrackedPlan[],
  diffByPlanId: Map<string, LiveVsPlanDiff>
): Array<{ plan: TrackedPlan; diff: LiveVsPlanDiff }> {
  return plans
    .map((plan) => {
      const diff = diffByPlanId.get(plan.id);
      if (!diff) return null;
      if (diff.thesis.status === "invalid" || diff.thesis.status === "weakened") {
        return { plan, diff };
      }
      return null;
    })
    .filter((x): x is { plan: TrackedPlan; diff: LiveVsPlanDiff } => x != null);
}
