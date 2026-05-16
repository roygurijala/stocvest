import { fetchDashboardScannerCoreSlice } from "@/lib/dashboard/dashboard-page-data";
import type { ScannerLoadTuning } from "@/lib/api/scanner";
import { DashboardScannerHydrate } from "@/components/dashboard/dashboard-scanner-hydrate";

/** RSC: heavy scanner pipeline — streams after market slice paints (Tier 1.C). */
export async function DashboardScannerDeferredFetch({ tuning }: { tuning: ScannerLoadTuning }) {
  const scannerCore = await fetchDashboardScannerCoreSlice(tuning);
  const overview = {
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    morningBrief: undefined,
    error: scannerCore.error,
    spyPct: scannerCore.spyPct,
    qqqPct: scannerCore.qqqPct,
    regimeLabel: scannerCore.regimeLabel,
    swingUniverseSymbolCount: scannerCore.swingUniverseSymbolCount ?? null,
    gapIntelligenceSnapshotSymbolCount: scannerCore.gapIntelligenceSnapshotSymbolCount ?? null,
    watchlistStatus: scannerCore.watchlistStatus ?? null,
    scanSummary: scannerCore.scanSummary ?? null
  };
  return <DashboardScannerHydrate overview={overview} />;
}
