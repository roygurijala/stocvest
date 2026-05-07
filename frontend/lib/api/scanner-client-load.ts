import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import { runScannerLoadWithoutBrief } from "@/lib/api/scanner-load";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { DaySetupsRequestExtras, ScannerCoreData, ScannerLoadTuning } from "@/lib/api/scanner";

async function fetchDefaultWatchlistSymbolsBrowser(): Promise<string[]> {
  try {
    const data = await browserApiFetch<{ symbols?: string[] }>("/v1/watchlists/default/symbols");
    if (!data || !Array.isArray(data.symbols)) {
      return [];
    }
    return data.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
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
    fetchDefaultWatchlistSymbolsBrowser,
    _pdtStatus,
    watchlistSymbols,
    tuning,
    daySetupsExtras
  );
}
