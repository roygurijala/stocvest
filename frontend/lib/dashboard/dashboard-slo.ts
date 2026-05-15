/**
 * Dashboard terminal UX SLO targets + fetch budgets (Tier 1.C Phase 5).
 *
 * Product targets live in `docs/DASHBOARD_TERMINAL_UX_PLAN.md` §3.
 * Measure with `[dashboard-load]` logs when dashboard timing is enabled
 * (`STOCVEST_DASHBOARD_TIMING`, Redis admin toggle, or `development` — see `load-timing.ts`).
 */

import {
  DASHBOARD_DAILY_BARS_TIMEOUT_MS,
  DASHBOARD_EARNINGS_TIMEOUT_MS,
  DASHBOARD_MARKET_TIMEOUT_MS,
  DASHBOARD_SCANNER_TIMEOUT_MS
} from "@/lib/dashboard/dashboard-page-data";

/** User-facing milestones (warm network, P75 unless noted). */
export const DASHBOARD_SLO_TARGETS = {
  /** Shell + market tape from first RSC segment (`fetchDashboardFirstSegment`). */
  firstContentfulP75Ms: 2000,
  /** Scanner deferred hydrate + desks interactive. */
  scannerDesksUsableP75Ms: 8000,
  /** Product hard ceiling — partial UI + explicit degraded copy, never silent blank. */
  productHardCeilingMs: 15_000
} as const;

/** Server-side per-fetch ceilings wired in `dashboard-page-data.ts`. */
export const DASHBOARD_FETCH_BUDGETS = {
  marketTimeoutMs: DASHBOARD_MARKET_TIMEOUT_MS,
  scannerTimeoutMs: DASHBOARD_SCANNER_TIMEOUT_MS,
  earningsTimeoutMs: DASHBOARD_EARNINGS_TIMEOUT_MS,
  dailyBarsTimeoutMs: DASHBOARD_DAILY_BARS_TIMEOUT_MS
} as const;

/** Labels emitted by `timeDashboardPhase` / `[dashboard-load]` (Phase 0). */
export const DASHBOARD_LOAD_PHASES = [
  "user_me",
  "dashboard_summary",
  "market_overview",
  "daily_bar_closes",
  "earnings_calendar",
  "scanner_core"
] as const;

export type DashboardLoadPhase = (typeof DASHBOARD_LOAD_PHASES)[number];

/** Whether a measured end-to-end duration meets the product hard-ceiling SLO. */
export function isWithinDashboardHardCeiling(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= 0 && durationMs < DASHBOARD_SLO_TARGETS.productHardCeilingMs;
}

/** Whether a single phase duration meets the first-contentful budget (summary fast path). */
export function isWithinFirstContentfulBudget(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= 0 && durationMs < DASHBOARD_SLO_TARGETS.firstContentfulP75Ms;
}
