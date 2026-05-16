import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import { runScannerLoadWithoutBrief } from "@/lib/api/scanner-load";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { DaySetupsRequestExtras, ScannerCoreData, ScannerLoadTuning } from "@/lib/api/scanner";

async function fetchDefaultWatchlistSnapshotBrowser() {
  try {
    const data = await browserApiFetch<{
      symbols?: string[];
      symbol_tracking?: Record<string, { swing?: boolean; day?: boolean }>;
    }>("/v1/watchlists/default/symbols");
    if (!data || !Array.isArray(data.symbols)) {
      return { symbols: [] as string[], symbol_tracking: {} as Record<string, { swing: boolean; day: boolean }> };
    }
    const symbols = data.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    const symbol_tracking: Record<string, { swing: boolean; day: boolean }> = {};
    const raw = data.symbol_tracking ?? {};
    for (const sym of symbols) {
      const row = raw[sym];
      symbol_tracking[sym] = {
        swing: Boolean(row?.swing ?? true),
        day: Boolean(row?.day ?? true)
      };
    }
    return { symbols, symbol_tracking };
  } catch {
    return { symbols: [] as string[], symbol_tracking: {} as Record<string, { swing: boolean; day: boolean }> };
  }
}

/** Client Component path — no `next/headers`; uses session cookie + optional WS token. */
export async function loadScannerDataWithoutBrief(
  _pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = [],
  tuning: ScannerLoadTuning | null = null,
  daySetupsExtras: DaySetupsRequestExtras | null = null
): Promise<ScannerCoreData> {
  return runScannerLoadWithoutBrief(
    browserApiFetch,
    fetchDefaultWatchlistSnapshotBrowser,
    _pdtStatus,
    watchlistSymbols,
    tuning,
    daySetupsExtras
  );
}
