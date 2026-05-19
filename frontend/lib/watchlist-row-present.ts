import {
  alignmentDisplayMeta,
  formatLayersFromActionableHint,
  formatWatchlistMaturationDisplayLine,
  formatWatchlistProgressionChip
} from "@/lib/alignment-display-tier";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";

export type WatchlistDeskStatusPresent = {
  primary: string;
  secondary: string | null;
  layerFillPct: number;
  progression: string | null;
  aligned: number;
  total: number;
};

export function watchlistLayerFillPct(row: WatchlistMaturationRow | undefined): number {
  const { aligned, total } = maturationAlignmentCounts(row);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((aligned / total) * 100)));
}

export function buildWatchlistDeskStatusPresent(
  row: WatchlistMaturationRow | undefined
): WatchlistDeskStatusPresent | null {
  if (!row?.state && !row?.label) return null;
  const { aligned, total } = maturationAlignmentCounts(row);
  const primary =
    formatWatchlistMaturationDisplayLine(row) ?? formatWatchlistMaturationLabel(row);
  const readiness = row.readiness_label?.trim();
  const secondary = readiness || formatLayersFromActionableHint(aligned, total);
  return {
    primary,
    secondary,
    layerFillPct: watchlistLayerFillPct(row),
    progression: formatWatchlistProgressionChip(row),
    aligned,
    total
  };
}

export function watchlistStatusRailColor(
  state: string | undefined,
  colors: { bullish: string; textMuted: string }
): string {
  switch ((state ?? "").toLowerCase()) {
    case "actionable":
      return colors.bullish;
    case "developing":
    case "re_evaluating":
      return "#f59e0b";
    default:
      return colors.textMuted;
  }
}

export function watchlistLayerBarColor(
  row: WatchlistMaturationRow | undefined,
  colors: { bullish: string; textMuted: string }
): string {
  if (!row) return colors.textMuted;
  const meta = alignmentDisplayMeta({
    layersAligned: row.layers_aligned ?? 0,
    layersTotal: row.layers_total,
    maturationState: row.state
  });
  switch (meta.tone) {
    case "bullish":
      return colors.bullish;
    case "near":
    case "caution":
      return "#f59e0b";
    default:
      return colors.textMuted;
  }
}

export type WatchlistPortfolioSummary = {
  actionable: number;
  developing: number;
  notAligned: number;
  invalidated: number;
  monitored: number;
};

export function buildWatchlistPortfolioHeadline(counts: WatchlistPortfolioSummary): string {
  const parts: string[] = [];
  if (counts.actionable > 0) {
    parts.push(`${counts.actionable} actionable`);
  }
  if (counts.developing > 0) {
    parts.push(`${counts.developing} developing`);
  }
  if (parts.length === 0 && counts.monitored > 0) {
    return `${counts.monitored} monitored — no setups at threshold yet`;
  }
  if (parts.length === 0) return "Add symbols to track maturation";
  return parts.join(" · ");
}
