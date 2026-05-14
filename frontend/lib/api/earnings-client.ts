import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import type { EarningsResponse } from "@/lib/api/earnings-types";
import { normalizeEarningsResponse } from "@/lib/api/earnings-types";

/** Browser-only earnings fetch (cookie session). */
export async function fetchEarningsCalendarClient(symbols: string[], days = 7): Promise<EarningsResponse> {
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (cleanSymbols.length === 0) {
    return { symbols: cleanSymbols, days, upcoming: [], recent: [], notice: null };
  }
  const payload = await browserApiFetch<EarningsResponse>(
    `/v1/market/earnings?symbols=${encodeURIComponent(cleanSymbols.join(","))}&days=${days}`
  );
  return normalizeEarningsResponse(cleanSymbols, days, payload);
}
