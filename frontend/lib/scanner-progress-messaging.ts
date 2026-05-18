/**
 * B47 — Scanner / empty-state progress copy (presentation only).
 *
 * Uses alignment display tiers; does not relax setup gates.
 */

import type { WatchlistDashboardStatus } from "@/lib/api/scanner";
import {
  alignmentDisplayMeta,
  layersAwayFromActionable,
  type AlignmentDisplayTier
} from "@/lib/alignment-display-tier";

export type ScannerProgressHints = {
  nearQualificationCount: number;
  watchlistDeveloping: number;
  watchlistActionable: number;
  watchlistMonitored: number;
};

export function buildScannerProgressHints(input: {
  nearCount: number;
  watchlist: WatchlistDashboardStatus | null | undefined;
}): ScannerProgressHints {
  const wl = input.watchlist;
  return {
    nearQualificationCount: input.nearCount,
    watchlistDeveloping: wl?.developing ?? 0,
    watchlistActionable: wl?.actionable ?? 0,
    watchlistMonitored: wl?.monitored ?? 0
  };
}

/** Hero sub-headline when nothing qualifies but progression exists. */
export function buildScannerUnifiedHeadline(input: {
  qualifyingTotal: number;
  nearCount: number;
  progressionCount: number;
  watchlist: WatchlistDashboardStatus | null | undefined;
}): string {
  const { qualifyingTotal, nearCount, progressionCount, watchlist } = input;
  if (qualifyingTotal > 0) {
    return qualifyingTotal === 1 ? "1 qualifying setup" : `${qualifyingTotal} qualifying setups`;
  }
  if (nearCount > 0) {
    const n = nearCount === 1 ? "1 setup" : `${nearCount} setups`;
    return `Nothing ready — ${n} approaching threshold`;
  }
  if (progressionCount > 0) {
    return `Nothing ready — watchlist progressing (${progressionCount} symbol${progressionCount === 1 ? "" : "s"})`;
  }
  const developing = watchlist?.developing ?? 0;
  if (developing > 0) {
    return `Nothing ready — ${developing} watchlist symbol${developing === 1 ? "" : "s"} developing`;
  }
  return "No setups passed filters this scan";
}

/** Appended to desk empty-state one-liners when scan has progression signal. */
export function scannerProgressOneLinerSuffix(hints: ScannerProgressHints | undefined): string {
  if (!hints || hints.watchlistActionable > 0) return "";
  if (hints.nearQualificationCount > 0) {
    const n = hints.nearQualificationCount;
    return ` Scanner also flagged ${n} symbol${n === 1 ? "" : "s"} approaching the setup threshold (below the score floor).`;
  }
  if (hints.watchlistDeveloping > 0) {
    const d = hints.watchlistDeveloping;
    return ` Your watchlist has ${d} symbol${d === 1 ? "" : "s"} with developing alignment.`;
  }
  return "";
}

export function formatScannerNearAlignmentLine(
  aligned: number,
  total: number
): { chip: string; layersAway: number; tier: AlignmentDisplayTier; emoji: string } {
  const meta = alignmentDisplayMeta({ layersAligned: aligned, layersTotal: total });
  const away = layersAwayFromActionable(aligned, total);
  const chip =
    away > 0
      ? `${meta.emoji} ${meta.label} (${aligned}/${total}) · ${away === 1 ? "1 layer from threshold" : `${away} layers from threshold`}`
      : `${meta.emoji} ${meta.label} (${aligned}/${total})`;
  return { chip, layersAway: away, tier: meta.tier, emoji: meta.emoji };
}

/** Supplemental watchlist strip when nothing is actionable yet. */
export function buildWatchlistInsightSupplement(
  wl: WatchlistDashboardStatus,
  qualifyingTotal: number
): string | null {
  if (qualifyingTotal > 0 || wl.actionable > 0) return null;
  if (wl.developing > 0) {
    return `Nothing actionable yet · ${wl.developing} developing on watchlist`;
  }
  return null;
}
