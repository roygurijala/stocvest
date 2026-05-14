/**
 * Dashboard Edge cache — versioned envelopes from /api/dashboard.
 * SSE hints only trigger re-fetch; never treat the hint payload as authoritative state.
 */

export interface CacheEnvelope<T = unknown> {
  state_version: string;
  computed_at: string;
  market_date: string;
  ttl_seconds: number;
  data: T;
}

export interface DashboardResponse {
  mode: string;
  served_at: string;
  source: "edge_cache" | "edge_cache_miss" | "edge_cache_error" | "edge_cache_unconfigured" | string;
  swing_signals: CacheEnvelope | null;
  day_signals: CacheEnvelope | null;
  market_pulse: CacheEnvelope | null;
  sector_rotation: CacheEnvelope | null;
  upcoming_events: CacheEnvelope | null;
  active_positions: CacheEnvelope | null;
  geo_themes: CacheEnvelope | null;
}

const VERSION_RE = /^swing_\d{4}_\d{2}_\d{2}$|^day_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}$/;

export function isValidStateVersion(v: string | undefined | null): boolean {
  return typeof v === "string" && VERSION_RE.test(v.trim());
}

export function isStale(envelope: CacheEnvelope<unknown> | null | undefined): boolean {
  if (!envelope) return true;
  if (!isValidStateVersion(envelope.state_version)) return true;
  if (!envelope.computed_at) return true;
  if (typeof envelope.ttl_seconds !== "number" || !Number.isFinite(envelope.ttl_seconds)) return true;

  const age = Date.now() - new Date(envelope.computed_at).getTime();
  const maxAge = envelope.ttl_seconds * 1000 * 1.5;
  return age > maxAge;
}

export async function fetchDashboardData(mode: "swing" | "day"): Promise<DashboardResponse> {
  const response = await fetch(`/api/dashboard?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Dashboard fetch failed: ${response.status}`);
  }
  return response.json() as Promise<DashboardResponse>;
}
