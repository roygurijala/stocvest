/**
 * Opportunity Desk cache — GET /v1/desk/today (D13).
 * @see docs/OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md
 */

export type DeskTodayMode = "swing" | "day";

export type DeskDiscoveryLeader = {
  symbol: string;
  gap_percent: number;
  direction: "up" | "down";
  rank_score: number;
  day_volume?: number;
  session_price?: number;
  desk: DeskTodayMode;
  verdict?: string | null;
  alignment_ratio?: number | null;
  risk_reward?: number | null;
  composite_status?: string | null;
  execution_hint?: string | null;
};

export type DeskMoverRadarRow = {
  symbol: string;
  gap_percent: number;
  direction: "up" | "down";
  rank_score: number;
};

export type DeskRetainedPoolRow = DeskMoverRadarRow & {
  day_volume?: number;
  session_price?: number;
  rank_position?: number;
};

export type DeskRecentlyHotRow = {
  symbol: string;
  dropped_at: string;
  gap_percent?: number | null;
  reason?: string;
};

export type DeskQuietLeader = DeskDiscoveryLeader & {
  technical_score?: number | null;
  daily_rsi?: number | null;
  quiet_leader?: boolean;
  why_line?: string | null;
};

export type DeskTodayData = {
  tier?: string;
  snapshot_source?: string;
  scanned_snapshot_count?: number;
  eligible_symbol_count?: number;
  survivor_limit_used?: number;
  generated_at?: string;
  /** NY trading date (YYYY-MM-DD) when movers were computed — clears stale session activity at open. */
  session_trading_date?: string;
  discovery?: DeskDiscoveryLeader[];
  movers_radar?: DeskMoverRadarRow[];
  retained_pool?: DeskRetainedPoolRow[];
  rejection_reason_counts?: Record<string, number>;
  rejected_samples?: Array<{ symbol: string; reason: string; seen_at?: string }>;
  recently_hot?: DeskRecentlyHotRow[];
  quiet_leaders?: DeskQuietLeader[];
};

export type DeskWhyMissingDiagnostic = {
  symbol: string;
  stage: string;
  reason_code: string;
  reason: string;
  rank_position?: number;
  rank_score?: number;
  snapshot_source?: string;
  scanned_snapshot_count?: number;
  eligible_symbol_count?: number;
  survivor_limit_used?: number;
};

export type DeskTodayResponse = {
  mode: DeskTodayMode;
  source: "cache" | "cache_miss" | string;
  envelope?: Record<string, unknown> | null;
  data: DeskTodayData | null;
  why_missing?: DeskWhyMissingDiagnostic | null;
  disclaimer?: string;
};

export async function fetchDeskToday(mode: DeskTodayMode): Promise<DeskTodayResponse> {
  const res = await fetch(`/api/stocvest/desk/today?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store"
  });
  const body = (await res.json().catch(() => ({}))) as DeskTodayResponse;
  if (!res.ok) {
    throw new Error(`desk/today failed: ${res.status}`);
  }
  return body;
}

export async function fetchDeskWhyMissing(
  mode: DeskTodayMode,
  symbol: string
): Promise<DeskWhyMissingDiagnostic | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const res = await fetch(
    `/api/stocvest/desk/today?mode=${encodeURIComponent(mode)}&why_symbol=${encodeURIComponent(sym)}`,
    { cache: "no-store" }
  );
  const body = (await res.json().catch(() => ({}))) as DeskTodayResponse;
  if (!res.ok) {
    throw new Error(`desk/today why_missing failed: ${res.status}`);
  }
  return body.why_missing ?? null;
}
