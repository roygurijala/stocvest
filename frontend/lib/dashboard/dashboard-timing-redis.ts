import { Redis } from "@upstash/redis";

import type { DashboardLoadLogEntry } from "@/lib/dashboard/parse-load-timing-logs";

/** Redis list of JSON rows `{ t, phase, ms }`; shared across Vercel instances for admin visibility. */
export const DASHBOARD_TIMING_REDIS_KEY = "stocvest:admin:dashboard_load_timing";

/** Runtime on/off stored by admins (`"1"` / `"0"`); read when `STOCVEST_DASHBOARD_TIMING` is unset. */
export const DASHBOARD_TIMING_TOGGLE_KEY = "stocvest:admin:dashboard_timing_toggle";

const MAX_EVENTS = 500;
const TOGGLE_CACHE_MS = 3000;

let toggleCache: { expires: number; value: boolean | null } | null = null;

export function isUpstashRedisConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return Boolean(url && url.startsWith("http") && token);
}

function redisOrNull(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !url.startsWith("http") || !token) {
    return null;
  }
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

/**
 * Append one phase timing after `[dashboard-load]` is logged (fire-and-forget safe).
 * No-ops when Upstash is not configured; errors are swallowed by the caller.
 */
export function invalidateDashboardTimingToggleCache(): void {
  toggleCache = null;
}

/**
 * Current value of the admin toggle key. `null` = key missing or Redis unavailable.
 * Does not use the request cache (use for admin UI).
 */
export async function getDashboardTimingRedisToggleRaw(): Promise<boolean | null> {
  const redis = redisOrNull();
  if (!redis) return null;
  try {
    const v = await redis.get(DASHBOARD_TIMING_TOGGLE_KEY);
    if (v == null || v === "") return null;
    if (v === "1" || v === true) return true;
    if (v === "0" || v === false) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Cached read for hot `/dashboard` paths (avoids Redis on every phase within TTL).
 */
export async function readDashboardTimingToggleCached(): Promise<boolean | null> {
  const now = Date.now();
  if (toggleCache && now < toggleCache.expires) {
    return toggleCache.value;
  }
  const value = await getDashboardTimingRedisToggleRaw();
  toggleCache = { value, expires: now + TOGGLE_CACHE_MS };
  return value;
}

export async function setDashboardTimingRedisToggle(enabled: boolean): Promise<void> {
  const redis = redisOrNull();
  if (!redis) throw new Error("redis_not_configured");
  await redis.set(DASHBOARD_TIMING_TOGGLE_KEY, enabled ? "1" : "0");
  invalidateDashboardTimingToggleCache();
}

export async function clearDashboardTimingRedisToggle(): Promise<void> {
  const redis = redisOrNull();
  if (!redis) throw new Error("redis_not_configured");
  await redis.del(DASHBOARD_TIMING_TOGGLE_KEY);
  invalidateDashboardTimingToggleCache();
}

export async function recordDashboardLoadPhase(phase: string, ms: number): Promise<void> {
  const redis = redisOrNull();
  if (!redis) return;
  const payload = JSON.stringify({
    t: new Date().toISOString(),
    phase,
    ms
  });
  await redis.lpush(DASHBOARD_TIMING_REDIS_KEY, payload);
  await redis.ltrim(DASHBOARD_TIMING_REDIS_KEY, 0, MAX_EVENTS - 1);
}

/** Parse LPUSH/LRANGE rows into chronological `[dashboard-load]` entries for `buildDashboardTimingReport`. */
export function redisRowsToLogEntries(rows: string[]): DashboardLoadLogEntry[] {
  const parsed: { t: number; phase: string; ms: number }[] = [];
  for (const row of rows) {
    try {
      const o = JSON.parse(row) as { t?: string; phase?: unknown; ms?: unknown };
      if (typeof o.phase !== "string" || typeof o.ms !== "number" || !Number.isFinite(o.ms)) {
        continue;
      }
      const t = typeof o.t === "string" ? Date.parse(o.t) : NaN;
      parsed.push({ t: Number.isFinite(t) ? t : 0, phase: o.phase, ms: Math.round(o.ms) });
    } catch {
      // skip malformed row
    }
  }
  parsed.sort((a, b) => a.t - b.t || 0);
  return parsed.map(({ phase, ms }) => ({ phase, ms }));
}

export async function readDashboardTimingLogEntriesFromRedis(): Promise<
  DashboardLoadLogEntry[] | null
> {
  const redis = redisOrNull();
  if (!redis) return null;
  try {
    const rows = await redis.lrange(DASHBOARD_TIMING_REDIS_KEY, 0, MAX_EVENTS - 1);
    return redisRowsToLogEntries(rows.slice().reverse());
  } catch {
    return null;
  }
}
