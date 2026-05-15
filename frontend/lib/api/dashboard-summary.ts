import { apiFetch } from "@/lib/api/client";
import type { EarningsResponse } from "@/lib/api/earnings";
import type { MarketOverview, MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import { isNextRedirect } from "@/lib/next-errors";

/** Response from `GET /v1/dashboard/summary` (Tier 1.C Phase 2). */
export type DashboardSummaryPayload = {
  status?: MarketStatusPayload;
  snapshots: SnapshotPayload[];
  sparklines_by_symbol?: Record<string, number[]>;
  daily_closes: Record<string, number[]>;
  earnings: EarningsResponse;
  served_at?: string;
};

export type FetchDashboardSummaryOptions = {
  earningsSymbols: string[];
  earningsDays?: number;
  sparklineLimit?: number;
  dailyLimit?: number;
};

/** One Lambda round-trip for tape + daily closes + earnings (dashboard first segment). */
export async function fetchDashboardSummary(
  options: FetchDashboardSummaryOptions
): Promise<DashboardSummaryPayload | null> {
  const symbols = options.earningsSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const params = new URLSearchParams();
  if (symbols.length > 0) {
    params.set("earnings_symbols", symbols.join(","));
  }
  params.set("earnings_days", String(options.earningsDays ?? 7));
  params.set("sparkline_limit", String(options.sparklineLimit ?? 12));
  params.set("daily_limit", String(options.dailyLimit ?? 8));

  try {
    const payload = await apiFetch<DashboardSummaryPayload>(`/v1/dashboard/summary?${params.toString()}`);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const daily =
      payload.daily_closes && typeof payload.daily_closes === "object" ? payload.daily_closes : {};
    const earnings = payload.earnings ?? {
      symbols,
      days: options.earningsDays ?? 7,
      upcoming: [],
      recent: []
    };
    return {
      status: payload.status,
      snapshots: Array.isArray(payload.snapshots) ? payload.snapshots : [],
      sparklines_by_symbol: payload.sparklines_by_symbol,
      daily_closes: daily,
      earnings,
      served_at: payload.served_at
    };
  } catch (error: unknown) {
    if (isNextRedirect(error)) throw error;
    return null;
  }
}

export function marketOverviewFromDashboardSummary(
  summary: DashboardSummaryPayload
): MarketOverview {
  return {
    status: summary.status,
    snapshots: summary.snapshots,
    news: [],
    sparklinesBySymbol: summary.sparklines_by_symbol,
    error: summary.snapshots.length === 0 && !summary.status ? "Market data unavailable." : undefined
  };
}
