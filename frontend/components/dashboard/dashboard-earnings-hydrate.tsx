"use client";

import { useLayoutEffect } from "react";
import type { EarningsEvent } from "@/lib/api/earnings";
import { useReplaceDashboardEarnings } from "@/components/dashboard/dashboard-earnings-context";

/** Applies server-fetched earnings into client context (Tier 1.C deferred path). */
export function DashboardEarningsHydrate({
  upcoming,
  recent
}: {
  upcoming: EarningsEvent[];
  recent: EarningsEvent[];
}) {
  const replace = useReplaceDashboardEarnings();
  useLayoutEffect(() => {
    replace({ upcoming, recent });
  }, [upcoming, recent, replace]);
  return null;
}
