"use client";

import { useEffect, useMemo } from "react";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner-client-load";
import type { ScannerLoadTuning } from "@/lib/api/scanner";
import { useReplaceScannerOverview } from "@/components/dashboard/scanner-overview-context";
import { scannerCoreToOverview } from "@/components/dashboard/dashboard-scanner-hydrate";

/**
 * Client-side scanner load for the dashboard — avoids a second RSC flight chunk
 * that was aborting mid-stream as React `Connection closed` on production.
 */
export function DashboardScannerClientFetch({ tuning }: { tuning: ScannerLoadTuning }) {
  const replace = useReplaceScannerOverview();
  const tuningKey = useMemo(() => JSON.stringify(tuning), [tuning]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const core = await loadScannerDataWithoutBrief(null, [], tuning, null);
      if (cancelled) return;
      replace(scannerCoreToOverview(core));
    })();
    return () => {
      cancelled = true;
    };
  }, [replace, tuning, tuningKey]);

  return null;
}
