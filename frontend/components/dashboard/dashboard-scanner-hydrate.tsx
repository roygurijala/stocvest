"use client";

import { useLayoutEffect } from "react";
import type { ScannerCoreData, ScannerOverview } from "@/lib/api/scanner";
import { useReplaceScannerOverview } from "@/components/dashboard/scanner-overview-context";

export const EMPTY_SCANNER_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null,
  watchlistStatus: null,
  scanSummary: null,
  evaluationTrace: [],
  scannerSynthesis: null
};

export function normalizeScannerOverview(raw: ScannerOverview): ScannerOverview {
  return {
    ...EMPTY_SCANNER_OVERVIEW,
    ...raw,
    gapIntelligence: Array.isArray(raw.gapIntelligence) ? raw.gapIntelligence : [],
    setups: Array.isArray(raw.setups) ? raw.setups : [],
    evaluationTrace: Array.isArray(raw.evaluationTrace) ? raw.evaluationTrace : []
  };
}

export function scannerCoreToOverview(scannerCore: ScannerCoreData): ScannerOverview {
  return normalizeScannerOverview({
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    error: scannerCore.error,
    spyPct: scannerCore.spyPct,
    qqqPct: scannerCore.qqqPct,
    regimeLabel: scannerCore.regimeLabel,
    swingUniverseSymbolCount: scannerCore.swingUniverseSymbolCount ?? null,
    gapIntelligenceSnapshotSymbolCount: scannerCore.gapIntelligenceSnapshotSymbolCount ?? null,
    watchlistStatus: scannerCore.watchlistStatus ?? null,
    scanSummary: scannerCore.scanSummary ?? null,
    evaluationTrace: scannerCore.evaluationTrace ?? []
  });
}

/** Applies server-fetched scanner overview into client context (Tier 1.C deferred path). */
export function DashboardScannerHydrate({ overview }: { overview: ScannerOverview }) {
  const replace = useReplaceScannerOverview();
  useLayoutEffect(() => {
    replace(normalizeScannerOverview(overview));
  }, [overview, replace]);
  return null;
}
