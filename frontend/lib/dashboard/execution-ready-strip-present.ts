/**
 * Dashboard execution-ready strip — counts symbols that cleared desk gates for the active mode.
 *
 * Watchlist: maturation `state === actionable` (5/6+ layers aligned on last evaluation).
 * Market scan: scanner qualifying setups for the active desk (score + alignment bundle).
 *
 * Full per-symbol execution detail (R/R, confirmation) lives on Signals; these counts are
 * rollup entry points, not trade recommendations.
 */

import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { resolveAlignmentDisplayTier } from "@/lib/alignment-display-tier";

export type ExecutionReadyCounts = {
  watchlist: number;
  marketScan: number;
};

export type ExecutionReadyPill = {
  id: "watchlist" | "market";
  count: number;
  label: string;
  href: string;
  ariaLabel: string;
};

export const EXECUTION_READY_STRIP_TITLE = "Cleared desk gates";
export const EXECUTION_READY_STRIP_HINT =
  "Counts symbols that passed STOCVEST layer and desk thresholds for this mode. Open a list for full execution detail on Signals.";

export function isWatchlistExecutionReady(row: WatchlistMaturationRow | undefined): boolean {
  if (!row) return false;
  const state = (row.state ?? row.label ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (state === "actionable") return true;
  const aligned = typeof row.layers_aligned === "number" ? row.layers_aligned : 0;
  const total = row.layers_total ?? 6;
  return resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: row.state ?? row.label
  }) === "actionable";
}

export function countWatchlistExecutionReady(bySymbol: Record<string, WatchlistMaturationRow>): number {
  let n = 0;
  for (const row of Object.values(bySymbol)) {
    if (isWatchlistExecutionReady(row)) n += 1;
  }
  return n;
}

export function countMarketScanExecutionReady(
  scanSummary: ScannerScanSummary | null | undefined,
  mode: DashboardDeskMode
): number {
  if (!scanSummary?.qualifying) return 0;
  return mode === "swing" ? scanSummary.qualifying.swing : scanSummary.qualifying.day;
}

export function buildExecutionReadyCounts(input: {
  bySymbol: Record<string, WatchlistMaturationRow>;
  scanSummary: ScannerScanSummary | null | undefined;
  mode: DashboardDeskMode;
}): ExecutionReadyCounts {
  return {
    watchlist: countWatchlistExecutionReady(input.bySymbol),
    marketScan: countMarketScanExecutionReady(input.scanSummary, input.mode)
  };
}

export function executionReadyWatchlistHref(mode: DashboardDeskMode): string {
  const q = new URLSearchParams({ desk: mode, rail: "actionable" });
  return `/dashboard/watchlists?${q.toString()}`;
}

export function executionReadyMarketHref(mode: DashboardDeskMode): string {
  const q = new URLSearchParams({ mode });
  return `/dashboard/scanner?${q.toString()}`;
}

export function buildExecutionReadyPills(input: {
  counts: ExecutionReadyCounts;
  mode: DashboardDeskMode;
  deskLabel: string;
}): ExecutionReadyPill[] {
  const { counts, mode, deskLabel } = input;
  const pills: ExecutionReadyPill[] = [];
  if (counts.watchlist > 0) {
    const n = counts.watchlist;
    pills.push({
      id: "watchlist",
      count: n,
      label: `${n} on your list`,
      href: executionReadyWatchlistHref(mode),
      ariaLabel: `${n} watchlist symbol${n === 1 ? "" : "s"} cleared ${deskLabel} desk gates — open watchlists`
    });
  }
  if (counts.marketScan > 0) {
    const n = counts.marketScan;
    pills.push({
      id: "market",
      count: n,
      label: `${n} in market scan`,
      href: executionReadyMarketHref(mode),
      ariaLabel: `${n} qualifying setup${n === 1 ? "" : "s"} in ${deskLabel} market scan — open scanner`
    });
  }
  return pills;
}

export function executionReadyStripVisible(input: {
  counts: ExecutionReadyCounts;
  loading: boolean;
  systemSuppressed: boolean;
}): boolean {
  if (input.loading) return false;
  if (input.systemSuppressed) return false;
  return input.counts.watchlist > 0 || input.counts.marketScan > 0;
}
