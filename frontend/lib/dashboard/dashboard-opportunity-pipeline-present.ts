/**
 * Opportunity pipeline — dashboard section framing (progress before velocity).
 */

import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

/** @deprecated Title removed from dashboard UI — status line only. Kept for tests/docs. */
export const OPPORTUNITY_PIPELINE_TITLE = "Opportunity pipeline";

export type PipelineStageId = "watchlist" | "quiet" | "market";

export type PipelineStageMeta = {
  id: PipelineStageId;
  label: string;
  subtitle: string;
};

export const PIPELINE_STAGES: Record<PipelineStageId, PipelineStageMeta> = {
  watchlist: {
    id: "watchlist",
    label: "Your progress",
    subtitle: "Symbols you track that are building or nearly ready"
  },
  quiet: {
    id: "quiet",
    label: "Building structure",
    subtitle: "Strong swing structure before the session heats up"
  },
  market: {
    id: "market",
    label: "Session activity",
    subtitle: "What moved today — relevance and gates, not entries"
  }
};

export function buildPipelineStatusLine(opts: {
  mode: DashboardDeskMode;
  watchlistAttentionCount: number;
  buildingStructureCount: number;
  quietLeadersCount: number;
  marketActivityCount: number;
  nearReadyInMarket: number;
  systemSuppressed: boolean;
}): string {
  const parts: string[] = [];
  if (opts.watchlistAttentionCount > 0) {
    parts.push(
      `${opts.watchlistAttentionCount} on your list need${opts.watchlistAttentionCount === 1 ? "s" : ""} a look`
    );
  }
  if (opts.mode === "swing" && opts.buildingStructureCount > 0) {
    const n = opts.buildingStructureCount;
    const quiet = opts.quietLeadersCount;
    if (quiet > 0 && quiet < n) {
      parts.push(`${n} building structure (${quiet} quiet)`);
    } else {
      parts.push(`${n} building structure`);
    }
  }
  if (opts.marketActivityCount > 0) {
    parts.push(`${opts.marketActivityCount} active in market scan`);
  }
  if (opts.nearReadyInMarket > 0) {
    parts.push(`${opts.nearReadyInMarket} near-ready in scanner`);
  }
  if (parts.length === 0) {
    return opts.systemSuppressed
      ? "Desk is gated — quiet is normal until structure and regime align."
      : "Pipeline is quiet — normal for most sessions.";
  }
  return parts.join(" · ");
}
