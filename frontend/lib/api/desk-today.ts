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
  execution_actionable?: boolean | null;
  decision_state?: string | null;
  /** B79 — direction confidence (High/Moderate/Low) from the composite. */
  direction_confidence?: "High" | "Moderate" | "Low" | null;
  /** False when stop/target geometry cannot clear desk R/R — hide from feed surfaces. */
  desk_surface_eligible?: boolean | null;
  geometry_block_reason?: string | null;
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

export type DeskTodaySource = "cache" | "cache_stale" | "cache_miss" | string;

export type DeskTodayResponse = {
  mode: DeskTodayMode;
  source: DeskTodaySource;
  envelope?: Record<string, unknown> | null;
  data: DeskTodayData | null;
  why_missing?: DeskWhyMissingDiagnostic | null;
  disclaimer?: string;
};

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDeskToday(mode: DeskTodayMode): Promise<DeskTodayResponse> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`/api/stocvest/desk/today?mode=${encodeURIComponent(mode)}`, {
      cache: "no-store"
    });
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === 2) break;
    await sleep(500 * (attempt + 1));
  }
  const res = response;
  if (!res) throw new Error("desk/today failed: no response");
  const body = (await res.json().catch(() => ({}))) as DeskTodayResponse;
  if (!res.ok) {
    if (res.status >= 500) {
      return {
        mode,
        source: "cache_miss",
        data: null,
        envelope: null
      };
    }
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
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(
      `/api/stocvest/desk/today?mode=${encodeURIComponent(mode)}&why_symbol=${encodeURIComponent(sym)}`,
      { cache: "no-store" }
    );
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === 2) break;
    await sleep(500 * (attempt + 1));
  }
  const res = response;
  if (!res) return null;
  const body = (await res.json().catch(() => ({}))) as DeskTodayResponse;
  if (!res.ok) {
    if (res.status >= 500) return null;
    throw new Error(`desk/today why_missing failed: ${res.status}`);
  }
  return body.why_missing ?? null;
}
