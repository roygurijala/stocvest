import type { ScannerLoadTuning, ScannerSetupLoadMode } from "@/lib/api/scanner";

/**
 * Terminal funnel load — desk discovery comes from `useDeskToday` hooks in parallel;
 * skip duplicating desk-universe expansion inside scanner-load (saves 2 API round-trips).
 */
export function scannerTerminalLoadTuning(mode: ScannerSetupLoadMode): ScannerLoadTuning {
  return {
    parallelDefaultWatchlist: true,
    includeOpportunityDeskUniverse: false,
    maxUniverseSymbols: 72,
    scannerSetupLoadMode: mode,
    intradayBarLimit: 90,
    daySetupsLimit: 8,
    swingSetupsLimit: 6
  };
}
