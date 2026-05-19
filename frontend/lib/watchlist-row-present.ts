import {
  alignmentDisplayMeta,
  formatAlignmentStatusLine,
  formatLayersFromActionableHint,
  formatWatchlistMaturationDisplayLine,
  formatWatchlistProgressionChip,
  formatWatchlistProgressionDetail
} from "@/lib/alignment-display-tier";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";

export type WatchlistDeskStatusPresent = {
  /** e.g. "SWING · Developing (3/6)" */
  statusLine: string;
  /** e.g. "Waiting on volume confirmation" or "2 layers improved today" */
  detailLine: string | null;
  layerFillPct: number;
  /** Legacy chip text for tests that still assert ↑/↓ */
  progressionChip: string | null;
  aligned: number;
  total: number;
};

export function watchlistDeskLabel(desk: "swing" | "day"): string {
  return desk === "swing" ? "SWING" : "DAY";
}

export function watchlistLayerFillPct(row: WatchlistMaturationRow | undefined): number {
  const { aligned, total } = maturationAlignmentCounts(row);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((aligned / total) * 100)));
}

export function buildWatchlistDeskStatusPresent(
  row: WatchlistMaturationRow | undefined,
  desk: "swing" | "day"
): WatchlistDeskStatusPresent | null {
  if (!row?.state && !row?.label) return null;
  const { aligned, total } = maturationAlignmentCounts(row);
  const tierLine =
    formatWatchlistMaturationDisplayLine(row) ?? formatWatchlistMaturationLabel(row);
  const statusLine = `${watchlistDeskLabel(desk)} · ${tierLine}`;
  const readiness = row.readiness_label?.trim();
  const detailLine =
    readiness || formatWatchlistProgressionDetail(row) || formatLayersFromActionableHint(aligned, total);
  return {
    statusLine,
    detailLine,
    layerFillPct: watchlistLayerFillPct(row),
    progressionChip: formatWatchlistProgressionChip(row),
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
