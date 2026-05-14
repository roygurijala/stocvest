import { apiFetch } from "@/lib/api/client";
import type { EarningsResponse } from "@/lib/api/earnings-types";
import { normalizeEarningsResponse } from "@/lib/api/earnings-types";
import { earningsTimingLabel as earningsTimingLabelImpl } from "@/lib/earnings-timing";

export type { EarningsEvent, EarningsResponse } from "@/lib/api/earnings-types";
export { DEFAULT_EARNINGS_SYMBOLS, normalizeEarningsResponse } from "@/lib/api/earnings-types";

export async function fetchEarningsCalendar(symbols: string[], days = 7): Promise<EarningsResponse> {
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (cleanSymbols.length === 0) {
    return { symbols: cleanSymbols, days, upcoming: [], recent: [], notice: null };
  }
  const payload = await apiFetch<EarningsResponse>(
    `/v1/market/earnings?symbols=${encodeURIComponent(cleanSymbols.join(","))}&days=${days}`
  );
  return normalizeEarningsResponse(cleanSymbols, days, payload);
}

export const earningsTimingLabel = earningsTimingLabelImpl;
