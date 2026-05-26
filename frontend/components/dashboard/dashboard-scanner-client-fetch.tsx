"use client";

import { useEffect, useMemo } from "react";
import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import type { ScannerJsonFetch } from "@/lib/api/scanner-load";
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
    const abort = new AbortController();
    const jsonFetch: ScannerJsonFetch = (path, init) =>
      browserApiFetch(path, { ...init, signal: abort.signal });

    void (async () => {
      const core = await loadScannerDataWithoutBrief(null, [], tuning, null, jsonFetch);
      if (abort.signal.aborted) return;
      replace(scannerCoreToOverview(core));
    })();

    return () => {
      abort.abort();
    };
  }, [replace, tuning, tuningKey]);

  return null;
}
