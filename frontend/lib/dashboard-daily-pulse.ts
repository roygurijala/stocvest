/**
 * B47 — Dashboard daily pulse: per-desk maturation rollup using display tiers.
 */

import {
  formatWatchlistMaturationDisplayLine,
  layersAwayFromActionable,
  resolveAlignmentDisplayTier,
  type AlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export type DailyPulseClosestRow = {
  symbol: string;
  desk: "swing" | "day";
  label: string;
  layersAway: number;
};

export type DailyPulseDeskSummary = {
  desk: "swing" | "day";
  tracked: number;
  actionable: number;
  nearReady: number;
  developing: number;
  notAligned: number;
  reEvaluating: number;
  invalidated: number;
  closest: DailyPulseClosestRow[];
};

export type DailyPulseRollup = {
  swing: DailyPulseDeskSummary | null;
  day: DailyPulseDeskSummary | null;
};

function tierBucket(tier: AlignmentDisplayTier): keyof Pick<
  DailyPulseDeskSummary,
  "actionable" | "nearReady" | "developing" | "notAligned" | "reEvaluating" | "invalidated"
> {
  switch (tier) {
    case "actionable":
      return "actionable";
    case "near_ready":
      return "nearReady";
    case "developing":
      return "developing";
    case "re_evaluating":
      return "reEvaluating";
    case "invalidated":
      return "invalidated";
    default:
      return "notAligned";
  }
}

export function summarizeDailyPulseDesk(
  desk: "swing" | "day",
  bySymbol: Record<string, WatchlistMaturationRow>
): DailyPulseDeskSummary | null {
  const entries = Object.entries(bySymbol);
  if (entries.length === 0) return null;

  const summary: DailyPulseDeskSummary = {
    desk,
    tracked: entries.length,
    actionable: 0,
    nearReady: 0,
    developing: 0,
    notAligned: 0,
    reEvaluating: 0,
    invalidated: 0,
    closest: []
  };

  for (const [symbol, row] of entries) {
    const sym = symbol.trim().toUpperCase();
    if (!sym) continue;
    const aligned = typeof row.layers_aligned === "number" ? row.layers_aligned : 0;
    const total = row.layers_total ?? 6;
    const tier = resolveAlignmentDisplayTier({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: row.state
    });
    summary[tierBucket(tier)] += 1;

    const away = layersAwayFromActionable(aligned, total);
    if (away > 0) {
      summary.closest.push({
        symbol: sym,
        desk,
        layersAway: away,
        label: formatWatchlistMaturationDisplayLine(row) ?? sym
      });
    }
  }

  summary.closest.sort((a, b) => a.layersAway - b.layersAway || a.symbol.localeCompare(b.symbol));
  summary.closest = summary.closest.slice(0, 3);
  return summary;
}

export function buildDailyPulseRollup(input: {
  swingBySymbol: Record<string, WatchlistMaturationRow>;
  dayBySymbol: Record<string, WatchlistMaturationRow>;
  includeDayDesk: boolean;
}): DailyPulseRollup {
  return {
    swing: summarizeDailyPulseDesk("swing", input.swingBySymbol),
    day: input.includeDayDesk ? summarizeDailyPulseDesk("day", input.dayBySymbol) : null
  };
}

/** One-line desk headline for the pulse card. */
export function formatDailyPulseDeskHeadline(summary: DailyPulseDeskSummary): string {
  const desk = summary.desk === "swing" ? "Swing" : "Day";
  if (summary.actionable > 0) {
    const n = summary.actionable;
    return `${n} actionable on ${desk}`;
  }
  if (summary.nearReady > 0) {
    const n = summary.nearReady;
    return `Nothing actionable — ${n} near ready on ${desk}`;
  }
  if (summary.developing > 0) {
    const n = summary.developing;
    return `Nothing actionable — ${n} developing on ${desk}`;
  }
  if (summary.tracked > 0) {
    return `No setups approaching threshold on ${desk}`;
  }
  return `${desk} desk — no maturation rows yet`;
}

export function formatDailyPulseTierCounts(summary: DailyPulseDeskSummary): string {
  const parts: string[] = [];
  if (summary.actionable > 0) parts.push(`${summary.actionable} actionable`);
  if (summary.nearReady > 0) parts.push(`${summary.nearReady} near ready`);
  if (summary.developing > 0) parts.push(`${summary.developing} developing`);
  if (summary.notAligned > 0) parts.push(`${summary.notAligned} not aligned`);
  if (summary.reEvaluating > 0) parts.push(`${summary.reEvaluating} re-evaluating`);
  return parts.length > 0 ? parts.join(" · ") : "No evaluated symbols";
}

export function dailyPulseHasContent(rollup: DailyPulseRollup): boolean {
  return Boolean(rollup.swing?.tracked || rollup.day?.tracked);
}
