/**
 * Optional server-side timing for `/dashboard` RSC data loads (Tier 1.C Phase 0).
 *
 * Enable explicitly in any environment:
 *   STOCVEST_DASHBOARD_TIMING=1
 * Or rely on development mode (logs every dashboard request — can be noisy).
 */

export function isDashboardLoadTimingEnabled(): boolean {
  if (process.env.STOCVEST_DASHBOARD_TIMING === "1") return true;
  return process.env.NODE_ENV === "development";
}

/** Wrap an async dashboard fetch; logs `[dashboard-load] <label> <ms>ms` when timing is on. */
export async function timeDashboardPhase<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isDashboardLoadTimingEnabled()) {
    return fn();
  }
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    console.info(`[dashboard-load] ${label} ${ms}ms`);
  }
}
