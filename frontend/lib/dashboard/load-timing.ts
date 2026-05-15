/**
 * Optional server-side timing for `/dashboard` RSC data loads (Tier 1.C Phase 0).
 *
 * Precedence (first match wins):
 *   1. `STOCVEST_DASHBOARD_TIMING=0` → always off (kill switch)
 *   2. `STOCVEST_DASHBOARD_TIMING=1` → always on
 *   3. Upstash key `stocvest:admin:dashboard_timing_toggle` (`"1"` / `"0"`) when Redis is configured
 *   4. `NODE_ENV === "development"` → on; otherwise off
 *
 * Admins can change (3) from **`/dashboard/admin/dashboard-timing`** when Redis env is set.
 * Samples buffer to Redis list `stocvest:admin:dashboard_load_timing` while timing is on.
 */

import {
  getDashboardTimingRedisToggleRaw,
  isUpstashRedisConfigured,
  readDashboardTimingToggleCached,
  recordDashboardLoadPhase
} from "@/lib/dashboard/dashboard-timing-redis";

export type DashboardTimingSettingsSnapshot = {
  redisConfigured: boolean;
  envOverride: "on" | "off" | null;
  /** Redis key present: forced on/off. `null` → use step 4 default. */
  redisToggle: boolean | null;
  effectiveEnabled: boolean;
};

/** Public for admin API + UI. */
export async function resolveDashboardTimingEnabled(): Promise<boolean> {
  const env = process.env.STOCVEST_DASHBOARD_TIMING?.trim();
  if (env === "0") return false;
  if (env === "1") return true;
  const fromRedis = await readDashboardTimingToggleCached();
  if (fromRedis !== null) return fromRedis;
  return process.env.NODE_ENV === "development";
}

export async function getDashboardTimingSettingsSnapshot(): Promise<DashboardTimingSettingsSnapshot> {
  const env = process.env.STOCVEST_DASHBOARD_TIMING?.trim();
  let envOverride: "on" | "off" | null = null;
  if (env === "1") envOverride = "on";
  else if (env === "0") envOverride = "off";

  const redisConfigured = isUpstashRedisConfigured();
  const redisToggle = redisConfigured ? await getDashboardTimingRedisToggleRaw() : null;
  const effectiveEnabled = await resolveDashboardTimingEnabled();

  return {
    redisConfigured,
    envOverride,
    redisToggle,
    effectiveEnabled
  };
}

/** Wrap an async dashboard fetch; logs `[dashboard-load] <label> <ms>ms` when timing is on. */
export async function timeDashboardPhase<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!(await resolveDashboardTimingEnabled())) {
    return fn();
  }
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    console.info(`[dashboard-load] ${label} ${ms}ms`);
    void recordDashboardLoadPhase(label, ms).catch(() => {
      /* never block dashboard on optional Redis sample */
    });
  }
}
