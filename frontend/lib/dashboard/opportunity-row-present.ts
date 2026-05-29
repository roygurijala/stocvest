/**
 * Compact opportunity pipeline rows (building structure + session activity).
 */

import type { DeskDiscoveryLeader } from "@/lib/api/desk-today";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { formatDeskGapLine } from "@/lib/dashboard/desk-today-present";
import {
  hotInMarketSignalsHref,
  parseRiskRewardFromHint,
  resolveCompactStatusHeadline,
  resolveRiskReward,
  resolveSetupBadge,
  type HotInMarketSetupBadge,
  type HotInMarketSource
} from "@/lib/dashboard/hot-in-market-card-present";
import type { BuildingStructureRow } from "@/lib/dashboard/building-structure-present";
import { alignedLayersFromAlignmentRatio } from "@/lib/signals-page-present";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";

const LAYER_TOTAL = 6;

/** Default visible building-structure rows before expand. */
export const BUILDING_STRUCTURE_PREVIEW_COUNT = 4;

export type OpportunityRowTone = "bullish" | "bearish" | "muted" | "caution" | "accent";

export type OpportunityRowModel = {
  symbol: string;
  rank: number;
  layerDots: boolean[];
  layerTotal: number;
  /** Primary user-facing line (symbol-adjacent). */
  primaryLine: string;
  rrLine: string | null;
  detailLine: string | null;
  gapLine: string | null;
  gapTone: "bullish" | "bearish" | "muted";
  badgeLabel: string | null;
  sourceLabel: string | null;
  href: string;
  peek: string;
};

export function minDeskRiskReward(mode: DashboardDeskMode): number {
  return mode === "day" ? 1.2 : 2.0;
}

export { parseRiskRewardFromHint, resolveRiskReward } from "@/lib/dashboard/hot-in-market-card-present";

export function rrProximityNote(rr: number | null, minRr: number): string | null {
  if (rr == null || !Number.isFinite(rr)) return null;
  const gap = minRr - rr;
  if (gap <= 0.5) return "closest to threshold";
  if (gap <= 0.75) return "near desk minimum";
  if (rr < 0.7) return "wide stop vs target";
  if (rr >= 1.0) return "improving";
  return null;
}

export function setupBadgeLabelForSession(
  badge: HotInMarketSetupBadge,
  sessionMode: SessionActivityUiMode
): string | null {
  if (sessionMode === "extended") {
    switch (badge) {
      case "blocked":
        return "R/R gated · extended";
      case "mover":
        return "Extended mover";
      case "pending":
        return "Scan pending";
      case "weak":
        return "Weak execution";
      case "review":
        return "Review on Signals";
      case "actionable":
        return "Meets our gates";
      default:
        return null;
    }
  }
  if (sessionMode === "closed") {
    switch (badge) {
      case "blocked":
        return "Logged · R/R gated";
      case "mover":
        return "Logged mover";
      case "pending":
        return "Logged";
      case "weak":
        return "Logged · weak execution";
      case "review":
        return "Logged · review";
      case "actionable":
        return "Met gates today";
      default:
        return null;
    }
  }
  switch (badge) {
    case "actionable":
      return "Meets our gates";
    case "blocked":
      return "R/R blocks entry";
    case "weak":
      return "Weak execution";
    case "review":
      return "Review on Signals";
    case "pending":
      return "Setup scan pending";
    case "mover":
      return "Session mover · not an entry";
    default:
      return null;
  }
}

export { resolveCompactStatusHeadline } from "@/lib/dashboard/hot-in-market-card-present";

export function buildingStructureListHeadline(rows: BuildingStructureRow[]): string | null {
  if (rows.length === 0) return null;
  const quiet = rows.filter((r) => r.source === "quiet_leader").length;
  const near = rows.filter((r) => r.source === "near_qualification").length;
  if (quiet === rows.length) return `${rows.length} symbols · R/R blocking`;
  if (near > 0 && quiet > 0) {
    return `${rows.length} symbols · ${quiet} quiet · ${near} near-ready`;
  }
  if (near > 0) return `${rows.length} symbols · structure building`;
  return `${rows.length} symbols · under the surface`;
}

export function sortBuildingStructureRows(rows: BuildingStructureRow[]): BuildingStructureRow[] {
  const score = (row: BuildingStructureRow): number => {
    if (row.source === "quiet_leader" && row.quietLeader) {
      const rr = resolveRiskReward(row.quietLeader.risk_reward, row.quietLeader.execution_hint);
      return rr ?? -1;
    }
    if (row.source === "near_qualification" && row.nearQual) {
      return (row.nearQual.alignment?.aligned ?? 0) * 0.01;
    }
    if (row.source === "low_velocity" && row.lowVelocity) {
      return -Math.abs(row.lowVelocity.gap_percent);
    }
    return -999;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

function layerDotsFromAligned(aligned: number | null): boolean[] {
  return Array.from({ length: LAYER_TOTAL }, (_, i) => (aligned != null ? i < aligned : false));
}

function sourceLabelForBuildingRow(row: BuildingStructureRow): string | null {
  switch (row.source) {
    case "quiet_leader":
      return "Quiet";
    case "near_qualification":
      return "Near-ready";
    case "low_velocity":
      return "Under surface";
    default:
      return null;
  }
}

export function buildBuildingStructureRowModel(
  row: BuildingStructureRow,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    aligned: number | null;
    layerDots: boolean[];
    setupBadge: HotInMarketSetupBadge;
    riskReward: number | null;
    executionHint: string | null;
    gapLine: string | null;
    gapTone: OpportunityRowModel["gapTone"];
    peek: string;
    detailFallback: string | null;
    sessionMode: SessionActivityUiMode;
  }
): OpportunityRowModel {
  const minRr = minDeskRiskReward(input.mode);
  const quiet = row.source === "quiet_leader";
  const near = row.source === "near_qualification";
  const alignedCount = input.aligned ?? input.layerDots.filter(Boolean).length;

  return {
    symbol: row.symbol,
    rank: input.rank,
    layerDots: input.layerDots,
    layerTotal: LAYER_TOTAL,
    primaryLine: resolveCompactStatusHeadline({
      setupBadge: input.setupBadge,
      source: "desk_cache",
      aligned: alignedCount > 0 ? alignedCount : null,
      riskReward: input.riskReward,
      executionHint: input.executionHint,
      sessionMode: input.sessionMode,
      nearStructure: near,
      quietLeader: quiet
    }),
    rrLine: input.riskReward != null ? `R/R ${input.riskReward.toFixed(1)}:1` : null,
    detailLine: rrProximityNote(input.riskReward, minRr) ?? input.detailFallback,
    gapLine: input.gapLine,
    gapTone: input.gapTone,
    badgeLabel: setupBadgeLabelForSession(input.setupBadge, input.sessionMode),
    sourceLabel: sourceLabelForBuildingRow(row),
    href: hotInMarketSignalsHref(row.symbol, input.mode),
    peek: input.peek
  };
}

export function buildSessionActivityRowModels(
  leaders: DeskDiscoveryLeader[],
  input: {
    mode: DashboardDeskMode;
    source: HotInMarketSource;
    sessionMode: SessionActivityUiMode;
  }
): OpportunityRowModel[] {
  return leaders.map((leader, index) =>
    buildSessionActivityRowModel(leader, {
      rank: index + 1,
      mode: input.mode,
      source: input.source,
      sessionMode: input.sessionMode
    })
  );
}

export function buildSessionActivityRowModel(
  leader: DeskDiscoveryLeader,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    source: HotInMarketSource;
    sessionMode: SessionActivityUiMode;
  }
): OpportunityRowModel {
  const setupBadge = resolveSetupBadge(leader, input.mode, input.source);
  const aligned = alignedLayersFromAlignmentRatio(leader.alignment_ratio, LAYER_TOTAL);
  const layerDots = layerDotsFromAligned(aligned);
  const riskReward = resolveRiskReward(leader.risk_reward, leader.execution_hint);
  const minRr = minDeskRiskReward(input.mode);
  const gapLine = formatDeskGapLine(leader.gap_percent, leader.direction);
  const gapTone: OpportunityRowModel["gapTone"] =
    leader.direction === "up" ? "bullish" : leader.direction === "down" ? "bearish" : "muted";
  const primaryLine = resolveCompactStatusHeadline({
    setupBadge,
    source: input.source,
    aligned,
    riskReward,
    executionHint: leader.execution_hint ?? null,
    sessionMode: input.sessionMode
  });

  return {
    symbol: leader.symbol.trim().toUpperCase(),
    rank: input.rank,
    layerDots,
    layerTotal: LAYER_TOTAL,
    primaryLine,
    rrLine: riskReward != null ? `R/R ${riskReward.toFixed(1)}:1` : null,
    detailLine: setupBadge === "blocked" ? rrProximityNote(riskReward, minRr) : null,
    gapLine,
    gapTone,
    badgeLabel: setupBadgeLabelForSession(setupBadge, input.sessionMode),
    sourceLabel: null,
    href: hotInMarketSignalsHref(leader.symbol, input.mode),
    peek: leader.execution_hint?.trim() || primaryLine
  };
}
