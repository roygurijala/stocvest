"use client";

import { useLayoutEffect } from "react";
import { EMPTY_SCANNER_OVERVIEW, type ScannerOverview } from "@/lib/api/scanner";
import { useReplaceScannerOverview } from "@/components/dashboard/scanner-overview-context";

function normalizeScannerOverview(raw: ScannerOverview): ScannerOverview {
  return {
    ...EMPTY_SCANNER_OVERVIEW,
    ...raw,
    gapIntelligence: Array.isArray(raw.gapIntelligence) ? raw.gapIntelligence : [],
    setups: Array.isArray(raw.setups) ? raw.setups : [],
    evaluationTrace: Array.isArray(raw.evaluationTrace) ? raw.evaluationTrace : []
  };
}

/** Applies server-fetched scanner overview into client context (Tier 1.C deferred path). */
export function DashboardScannerHydrate({ overview }: { overview: ScannerOverview }) {
  const replace = useReplaceScannerOverview();
  useLayoutEffect(() => {
    replace(normalizeScannerOverview(overview));
  }, [overview, replace]);
  return null;
}
