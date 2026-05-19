import type { MarketStatusPayload } from "@/lib/api/market";

/** Polygon `/v1/marketstatus/now` — regular session only when `market` is `"open"`. */
export function isRegularSessionOpen(
  marketStatus: Pick<MarketStatusPayload, "market"> | undefined | null
): boolean {
  const mkt = (marketStatus?.market || "").trim().toLowerCase();
  return mkt === "open";
}
