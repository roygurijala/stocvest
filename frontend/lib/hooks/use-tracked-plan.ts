"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrackedPlan, TrackedPlanMode } from "@/lib/trade-plan/types";
import {
  getTrackedPlan,
  TRACKED_PLAN_UPDATED_EVENT
} from "@/lib/trade-plan/tracked-plan-store";

export function useTrackedPlan(symbol: string, mode: TrackedPlanMode): {
  plan: TrackedPlan | null;
  refresh: () => void;
} {
  const sym = symbol.trim().toUpperCase();
  // Start null to match SSR; the mount effect reads localStorage (avoids hydration mismatch).
  const [plan, setPlan] = useState<TrackedPlan | null>(null);

  const refresh = useCallback(() => {
    setPlan(getTrackedPlan(sym, mode));
  }, [sym, mode]);

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener(TRACKED_PLAN_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TRACKED_PLAN_UPDATED_EVENT, onUpdate);
  }, [refresh]);

  return { plan, refresh };
}
