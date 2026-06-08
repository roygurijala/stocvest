/**
 * `useMarketSessionPhase()` — live US-equity session phase for the nav status orb.
 *
 * Authoritative source is the venue calendar via `/v1/market/status` (Polygon
 * `marketstatus/now`), proxied through `/api/stocvest/market/status` so the
 * httpOnly session cookie is attached. That endpoint is **holiday-aware**:
 * it reports `closed` on market holidays even during regular hours.
 *
 * Polygon's `market` field is `open | closed | extended-hours` and does NOT
 * split pre- vs post-market, so we use the ET wall clock only to label which
 * side of the extended window we're in. While the status request is in flight
 * (or if it degrades) we fall back to the pure time-based read so the orb still
 * shows something sensible.
 */
"use client";

import useSWR from "swr";

import { getMarketSessionPhaseEt, type MarketSessionPhase } from "@/lib/market-hours-et";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const KEY = `${STOCVEST_SWR_CACHE_NS}market-status-phase` as const;

async function fetchMarketStatusMarket(): Promise<string> {
  const res = await fetch("/api/stocvest/market/status", { method: "GET", cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return "";
  try {
    const data = (await res.json()) as { market?: string };
    return typeof data.market === "string" ? data.market : "";
  } catch {
    return "";
  }
}

/** Maps the venue `market` status (+ ET clock for pre/post) to a session phase. */
export function resolveSessionPhase(market: string | undefined, now = new Date()): MarketSessionPhase {
  const m = (market || "").trim().toLowerCase();
  if (m === "open") return "live";
  if (m === "closed") return "closed";
  if (m === "extended-hours" || m === "extended_hours" || m === "extendedhours") {
    const clock = getMarketSessionPhaseEt(now);
    return clock === "pre" ? "pre" : "post";
  }
  // Unknown / degraded / still loading → time-based fallback.
  return getMarketSessionPhaseEt(now);
}

export function useMarketSessionPhase(): MarketSessionPhase {
  const { data } = useSWR([KEY] as const, fetchMarketStatusMarket, {
    revalidateOnFocus: false,
    // Status flips at open/close/holiday boundaries — a minute of latency is fine.
    refreshInterval: 60_000,
    dedupingInterval: 30_000
  });
  return resolveSessionPhase(data);
}
