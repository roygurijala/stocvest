"use client";

import { useLayoutEffect } from "react";
import type { ScannerOverview } from "@/lib/api/scanner";
import { useReplaceScannerOverview } from "@/components/dashboard/scanner-overview-context";

/** Applies server-fetched scanner overview into client context (Tier 1.C deferred path). */
export function DashboardScannerHydrate({ overview }: { overview: ScannerOverview }) {
  const replace = useReplaceScannerOverview();
  useLayoutEffect(() => {
    replace(overview);
  }, [overview, replace]);
  return null;
}
