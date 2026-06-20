import {
  deleteTradePlanClient,
  fetchTradePlansClient,
  syncTradePlansClient,
  upsertTradePlanClient
} from "@/lib/api/fetch-trade-plans-client";
import { mergeTrackedPlans } from "@/lib/trade-plan/tracked-plan-merge";
import {
  listTrackedPlans,
  writeAllTrackedPlans
} from "@/lib/trade-plan/tracked-plan-store";
import type { TrackedPlan } from "@/lib/trade-plan/types";

let hydrateInFlight: Promise<void> | null = null;
let lastHydratedAt = 0;
const HYDRATE_TTL_MS = 30_000;

/** Identity of a plan set, ignoring order — id + commit time per plan. */
function planSetSignature(plans: TrackedPlan[]): string {
  return plans
    .map((p) => `${p.id}@${p.committedAt}`)
    .sort()
    .join("|");
}

/**
 * Pull server plans, merge with localStorage, write back locally, and only push
 * back to the server when the merged set actually differs from what the server
 * returned (avoids a write on every page load).
 *
 * Concurrent callers share a single in-flight request; callers within the TTL
 * window are no-ops. `force` only bypasses the TTL, never the in-flight share.
 */
export async function hydrateTrackedPlansFromServer(force = false): Promise<void> {
  if (hydrateInFlight) return hydrateInFlight;
  if (!force && Date.now() - lastHydratedAt < HYDRATE_TTL_MS) return;

  hydrateInFlight = (async () => {
    try {
      const server = await fetchTradePlansClient();
      const local = listTrackedPlans();
      const merged = mergeTrackedPlans(local, server);
      writeAllTrackedPlans(merged);
      if (planSetSignature(merged) !== planSetSignature(server)) {
        const synced = await syncTradePlansClient(merged);
        if (synced.length > 0 || merged.length === 0) {
          writeAllTrackedPlans(synced);
        }
      }
      lastHydratedAt = Date.now();
    } catch {
      /* Offline or unauthenticated — keep local-only plans. */
    } finally {
      hydrateInFlight = null;
    }
  })();

  return hydrateInFlight;
}

export async function pushTrackedPlanToServer(plan: TrackedPlan): Promise<void> {
  try {
    await upsertTradePlanClient(plan);
  } catch {
    /* Local plan remains; next hydrate will retry sync. */
  }
}

export async function pushTrackedPlanRemovalToServer(planId: string): Promise<void> {
  try {
    await deleteTradePlanClient(planId);
  } catch {
    /* ignore */
  }
}

export async function pushTrackedPlansSync(plans: TrackedPlan[]): Promise<void> {
  try {
    await syncTradePlansClient(plans);
  } catch {
    /* ignore */
  }
}

