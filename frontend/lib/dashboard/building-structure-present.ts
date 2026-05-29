/**
 * Building structure — always show a small card grid on swing (quiet leaders + principled backfill).
 */

import type {
  DeskDiscoveryLeader,
  DeskMoverRadarRow,
  DeskQuietLeader,
  DeskTodayData
} from "@/lib/api/desk-today";
import {
  dashboardDirectionCardChrome,
  type DashboardCardTone
} from "@/lib/dashboard/dashboard-card-surface";
import { formatDeskGapLine } from "@/lib/dashboard/desk-today-present";
import {
  buildHotInMarketCardModel,
  hotInMarketSignalsHref,
  leaderHasCompositeDetail,
  resolveHotInMarketGapEmphasis,
  type HotInMarketCardModel,
  type HotInMarketThemeColors
} from "@/lib/dashboard/hot-in-market-card-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { buildQuietLeaderCardModel, quietLeadersFromDesk } from "@/lib/dashboard/quiet-leaders-present";
import { resolveAlignmentDisplayTier } from "@/lib/alignment-display-tier";
import { MIN_DEVELOPING_ALIGNED } from "@/lib/scanner/scanner-quiet-desk";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";

/** Target minimum cards so stage 2 is not blank on hot tapes (docs: 5–8 rows). */
export const BUILDING_STRUCTURE_MIN_CARDS = 6;
export const BUILDING_STRUCTURE_MAX_CARDS = 8;
export const BUILDING_STRUCTURE_LOW_VELOCITY_GAP_MAX = 2;
/** Hot-tape fallback — smallest session % among names not in Session activity top list. */
export const BUILDING_STRUCTURE_MODERATE_GAP_MAX = 15;

const LAYER_TOTAL = 6;

export type BuildingStructureSource =
  | "quiet_leader"
  | "near_qualification"
  | "low_velocity"
  | "moderate_velocity";

export type BuildingStructureRow = {
  source: BuildingStructureSource;
  symbol: string;
  quietLeader?: DeskQuietLeader;
  nearQual?: ScannerNearQualificationRow;
  lowVelocity?: DeskMoverRadarRow;
};

function symbolInSet(symbol: string, set: Set<string>): boolean {
  return set.has(symbol.trim().toUpperCase());
}

function gapFromDesk(
  symbol: string,
  deskData: DeskTodayData | null | undefined
): { gap_percent: number; direction: "up" | "down" } | null {
  const sym = symbol.trim().toUpperCase();
  const movers = deskData?.movers_radar ?? [];
  const hit = movers.find((m) => m.symbol.trim().toUpperCase() === sym);
  if (hit) return { gap_percent: hit.gap_percent, direction: hit.direction };
  const disc = deskData?.discovery ?? [];
  const d = disc.find((m) => m.symbol.trim().toUpperCase() === sym);
  if (d) return { gap_percent: d.gap_percent, direction: d.direction };
  return null;
}

function nearQualSortScore(row: ScannerNearQualificationRow): number {
  const aligned = row.alignment?.aligned ?? 0;
  const score = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0;
  return aligned * 100 + score;
}

/**
 * Resolve swing building-structure rows: true quiet leaders first, then scanner near-ready,
 * then low-velocity desk movers (|gap| &lt; 2%) — never duplicates session-activity top list.
 */
export function resolveBuildingStructureRows(input: {
  deskData: DeskTodayData | null | undefined;
  nearQualification: ScannerNearQualificationRow[];
  sessionActivitySymbols?: Iterable<string>;
}): BuildingStructureRow[] {
  const exclude = new Set<string>();
  for (const sym of input.sessionActivitySymbols ?? []) {
    const s = String(sym ?? "")
      .trim()
      .toUpperCase();
    if (s) exclude.add(s);
  }

  const result: BuildingStructureRow[] = [];
  const seen = new Set<string>();

  const push = (row: BuildingStructureRow) => {
    const sym = row.symbol.trim().toUpperCase();
    if (!sym || seen.has(sym) || symbolInSet(sym, exclude)) return;
    seen.add(sym);
    result.push({ ...row, symbol: sym });
  };

  for (const leader of quietLeadersFromDesk(input.deskData)) {
    push({ source: "quiet_leader", symbol: leader.symbol, quietLeader: leader });
  }

  if (result.length < BUILDING_STRUCTURE_MIN_CARDS) {
    const nearSorted = [...input.nearQualification]
      .filter((r) => r.desk === "swing")
      .filter((row) => {
        const aligned = row.alignment?.aligned ?? 0;
        if (aligned < MIN_DEVELOPING_ALIGNED) return false;
        const tier = resolveAlignmentDisplayTier({
          layersAligned: aligned,
          layersTotal: row.alignment?.total ?? LAYER_TOTAL
        });
        return tier === "near_ready" || tier === "developing" || aligned >= 4;
      })
      .sort((a, b) => nearQualSortScore(b) - nearQualSortScore(a));

    for (const row of nearSorted) {
      push({ source: "near_qualification", symbol: row.symbol, nearQual: row });
      if (result.length >= BUILDING_STRUCTURE_MAX_CARDS) break;
    }
  }

  const moversRadar = input.deskData?.movers_radar ?? [];

  if (result.length < BUILDING_STRUCTURE_MIN_CARDS) {
    const lowVelocity = [...moversRadar]
      .filter((m) => Math.abs(m.gap_percent) < BUILDING_STRUCTURE_LOW_VELOCITY_GAP_MAX)
      .sort((a, b) => b.rank_score - a.rank_score);

    for (const mover of lowVelocity) {
      push({ source: "low_velocity", symbol: mover.symbol, lowVelocity: mover });
      if (result.length >= BUILDING_STRUCTURE_MAX_CARDS) break;
    }
  }

  if (result.length < BUILDING_STRUCTURE_MIN_CARDS) {
    const moderate = [...moversRadar]
      .filter((m) => {
        const g = Math.abs(m.gap_percent);
        return g >= BUILDING_STRUCTURE_LOW_VELOCITY_GAP_MAX && g <= BUILDING_STRUCTURE_MODERATE_GAP_MAX;
      })
      .sort((a, b) => Math.abs(a.gap_percent) - Math.abs(b.gap_percent));

    for (const mover of moderate) {
      push({ source: "moderate_velocity", symbol: mover.symbol, lowVelocity: mover });
      if (result.length >= BUILDING_STRUCTURE_MAX_CARDS) break;
    }
  }

  if (result.length < BUILDING_STRUCTURE_MIN_CARDS) {
    const remainder = [...moversRadar].sort(
      (a, b) => Math.abs(a.gap_percent) - Math.abs(b.gap_percent)
    );

    for (const mover of remainder) {
      push({ source: "moderate_velocity", symbol: mover.symbol, lowVelocity: mover });
      if (result.length >= BUILDING_STRUCTURE_MAX_CARDS) break;
    }
  }

  return result.slice(0, BUILDING_STRUCTURE_MAX_CARDS);
}

export function buildingStructureQuietCount(rows: BuildingStructureRow[]): number {
  return rows.filter((r) => r.source === "quiet_leader").length;
}

export function buildingStructureHasBackfill(rows: BuildingStructureRow[]): boolean {
  return rows.some((r) => r.source !== "quiet_leader");
}

export function buildingStructureBackfillNote(rows: BuildingStructureRow[]): string | null {
  if (!buildingStructureHasBackfill(rows)) return null;
  const near = rows.filter((r) => r.source === "near_qualification").length;
  const low = rows.filter((r) => r.source === "low_velocity").length;
  const moderate = rows.filter((r) => r.source === "moderate_velocity").length;
  const parts: string[] = [];
  if (near > 0) parts.push(`${near} near-ready from scanner`);
  if (low > 0) parts.push(`${low} under 2% from desk`);
  if (moderate > 0) parts.push(`${moderate} smaller movers (not in top session list)`);
  return `Quiet leaders scarce today — includes ${parts.join(" and ")}. Open Signals before trading.`;
}

export function buildingStructureEmptyMessage(sessionActivityCount: number): string {
  if (sessionActivityCount > 0) {
    return "No names under the 2% quiet threshold right now — common on hot days. Session activity above shows today's bigger movers; open Scanner for the full quiet-leader list.";
  }
  return "None right now — common on hot days when most names are already up 2%+.";
}

function buildNearStructureCardModel(
  row: ScannerNearQualificationRow,
  input: {
    rank: number;
    deskData: DeskTodayData | null | undefined;
    colors: HotInMarketThemeColors;
  }
): HotInMarketCardModel {
  const aligned = row.alignment?.aligned ?? 0;
  const total = row.alignment?.total ?? LAYER_TOTAL;
  const layerDots = Array.from({ length: LAYER_TOTAL }, (_, i) => i < aligned);
  const gap = gapFromDesk(row.symbol, input.deskData);
  const gapLine = gap
    ? formatDeskGapLine(gap.gap_percent, gap.direction)
    : "· low session velocity";
  const gapTone: DashboardCardTone = gap
    ? gap.direction === "up"
      ? "bullish"
      : gap.direction === "down"
        ? "bearish"
        : "muted"
    : "muted";
  const setupBadge = "review" as const;
  const setupBadgeLabel = "Near structure";
  const cardChrome = dashboardDirectionCardChrome(gapTone, {
    surface: input.colors.surface,
    border: input.colors.border,
    bullish: input.colors.bullish,
    bearish: input.colors.bearish,
    textMuted: input.colors.textMuted
  });
  const alignmentLine = `${aligned}/${total} layers aligned`;
  const away =
    typeof row.layers_away === "number" && Number.isFinite(row.layers_away)
      ? row.layers_away
      : Math.max(0, 5 - aligned);

  return {
    symbol: row.symbol.trim().toUpperCase(),
    rank: input.rank,
    gapLine,
    gapTone,
    gapEmphasis: resolveHotInMarketGapEmphasis(setupBadge),
    priceLine: null,
    deskLabel: "swing · scanner near-ready",
    statusHeadline:
      away <= 1
        ? "Close to desk gates — structure before velocity"
        : "Structure building — not a session mover",
    alignmentLine,
    layerDots,
    layerTotal: LAYER_TOTAL,
    verdictLine: null,
    detailLine: `${alignmentLine} · open Signals for full read`,
    volumeLine: null,
    setupBadge,
    setupBadgeLabel,
    cardTone: gapTone,
    cardChrome,
    peek: "Near-ready in platform scan — context only"
  };
}

function buildLowVelocityStructureCardModel(
  mover: DeskMoverRadarRow,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    deskData: DeskTodayData | null | undefined;
    colors: HotInMarketThemeColors;
    moderateSessionMove?: boolean;
  }
): HotInMarketCardModel {
  const leader: DeskDiscoveryLeader = {
    symbol: mover.symbol.trim().toUpperCase(),
    gap_percent: mover.gap_percent,
    direction: mover.direction,
    rank_score: mover.rank_score,
    desk: "swing"
  };
  const hasDetail = leaderHasCompositeDetail(leader);
  const base = buildHotInMarketCardModel(leader, {
    rank: input.rank,
    mode: input.mode,
    source: hasDetail ? "desk_cache" : "movers_radar",
    colors: input.colors
  });
  if (input.moderateSessionMove) {
    return {
      ...base,
      setupBadge: "review",
      setupBadgeLabel: "Under the surface",
      gapEmphasis: resolveHotInMarketGapEmphasis("review"),
      deskLabel: "swing · smaller session move",
      statusHeadline: "Smaller session % — structure context, not a top mover",
      detailLine: "Not in your top session list · open Signals for gates",
      peek: "Smaller session move — structure context only"
    };
  }
  if (hasDetail) {
    return {
      ...base,
      deskLabel: "swing · low velocity",
      setupBadgeLabel: "Quiet candidate",
      statusHeadline: base.statusHeadline || "Low velocity — structure scan on desk"
    };
  }
  return {
    ...base,
    setupBadge: "pending",
    setupBadgeLabel: "Structure scan pending",
    gapEmphasis: resolveHotInMarketGapEmphasis("pending"),
    deskLabel: "swing · low velocity",
    statusHeadline: "Low velocity — quiet-leader scan still loading",
    detailLine: "Ranked under 2% today · open Signals when composite lands",
    peek: "Low velocity — quiet-leader scan still loading"
  };
}

export function buildBuildingStructureCardModel(
  row: BuildingStructureRow,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    deskData: DeskTodayData | null | undefined;
    colors: HotInMarketThemeColors;
  }
): HotInMarketCardModel {
  if (row.source === "quiet_leader" && row.quietLeader) {
    return buildQuietLeaderCardModel(row.quietLeader, {
      rank: input.rank,
      mode: "swing",
      colors: input.colors
    });
  }
  if (row.source === "near_qualification" && row.nearQual) {
    return buildNearStructureCardModel(row.nearQual, input);
  }
  if ((row.source === "low_velocity" || row.source === "moderate_velocity") && row.lowVelocity) {
    return buildLowVelocityStructureCardModel(row.lowVelocity, {
      ...input,
      moderateSessionMove: row.source === "moderate_velocity"
    });
  }
  return {
    symbol: row.symbol,
    rank: input.rank,
    gapLine: "·",
    gapTone: "muted",
    gapEmphasis: "secondary",
    priceLine: null,
    deskLabel: "swing",
    statusHeadline: "Open Signals for structure read",
    alignmentLine: null,
    layerDots: Array(LAYER_TOTAL).fill(false),
    layerTotal: LAYER_TOTAL,
    verdictLine: null,
    detailLine: null,
    volumeLine: null,
    setupBadge: "review",
    setupBadgeLabel: "Building structure",
    cardTone: "muted",
    cardChrome: dashboardDirectionCardChrome("muted", {
      surface: input.colors.surface,
      border: input.colors.border,
      bullish: input.colors.bullish,
      bearish: input.colors.bearish,
      textMuted: input.colors.textMuted
    }),
    peek: "Open Signals for structure read"
  };
}

export { hotInMarketSignalsHref as buildingStructureSignalsHref };
