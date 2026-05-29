import type { ScannerCoreData, ScannerOverview } from "@/lib/api/scanner";

/** Merge scanner core load into overview state (keeps morning brief from prior). */
export function mergeScannerCoreIntoOverview(prev: ScannerOverview, core: ScannerCoreData): ScannerOverview {
  return {
    gapIntelligence: core.gapIntelligence,
    setups: core.setups,
    morningBrief: prev.morningBrief,
    error: core.error,
    spyPct: core.spyPct,
    qqqPct: core.qqqPct,
    regimeLabel: core.regimeLabel,
    swingUniverseSymbolCount: core.swingUniverseSymbolCount ?? null,
    gapIntelligenceSnapshotSymbolCount: core.gapIntelligenceSnapshotSymbolCount ?? null,
    gapIntelligenceSnapshotSource: core.gapIntelligenceSnapshotSource ?? null,
    gapIntelligenceUniverseNote: core.gapIntelligenceUniverseNote ?? null,
    watchlistStatus: core.watchlistStatus ?? null,
    scanSummary: core.scanSummary ?? null,
    evaluationTrace: core.evaluationTrace ?? [],
    scannerSynthesis: core.scannerSynthesis ?? null
  };
}
