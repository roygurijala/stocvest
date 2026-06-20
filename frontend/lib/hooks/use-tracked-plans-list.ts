"use client";

import { useCallback, useEffect, useState } from "react";
import { listTrackedPlans, TRACKED_PLAN_UPDATED_EVENT } from "@/lib/trade-plan/tracked-plan-store";
import { hydrateTrackedPlansFromServer } from "@/lib/trade-plan/tracked-plan-sync";
import type { TrackedPlan, TrackedPlanMode } from "@/lib/trade-plan/types";

export function useTrackedPlansList(): {
  plans: TrackedPlan[];
  refresh: () => void;
  syncing: boolean;
} {
  // Start empty to match SSR markup; the mount effect populates from localStorage.
  // Reading localStorage in the initializer would diverge from server HTML and cause
  // a hydration mismatch on any surface that renders tracked-plan UI (e.g. badges).
  const [plans, setPlans] = useState<TrackedPlan[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    setPlans(listTrackedPlans());
  }, []);

  useEffect(() => {
    refresh();
    let cancelled = false;
    setSyncing(true);
    void hydrateTrackedPlansFromServer().finally(() => {
      if (!cancelled) {
        refresh();
        setSyncing(false);
      }
    });
    const onUpdate = () => refresh();
    window.addEventListener(TRACKED_PLAN_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(TRACKED_PLAN_UPDATED_EVENT, onUpdate);
    };
  }, [refresh]);

  return { plans, refresh, syncing };
}

export function hasTrackedPlanForSymbol(
  plans: TrackedPlan[],
  symbol: string,
  mode?: TrackedPlanMode
): boolean {
  const sym = symbol.trim().toUpperCase();
  return plans.some((p) => p.symbol === sym && (mode == null || p.mode === mode));
}
