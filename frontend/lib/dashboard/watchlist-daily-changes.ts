/**
 * Summarize watchlist maturation movement for dashboard engagement copy.
 */

import {
  formatWatchlistProgressionDetail,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export type WatchlistDailyChanges = {
  improved: string[];
  weakened: string[];
  newlyNearReady: string[];
};

export function collectWatchlistDailyChanges(
  bySymbol: Record<string, WatchlistMaturationRow>
): WatchlistDailyChanges {
  const improved: string[] = [];
  const weakened: string[] = [];
  const newlyNearReady: string[] = [];

  for (const [sym, row] of Object.entries(bySymbol)) {
    const symbol = sym.trim().toUpperCase();
    if (!symbol) continue;
    if (row.last_transition_type === "improved") improved.push(symbol);
    if (row.last_transition_type === "worsened") weakened.push(symbol);
    const { aligned, total } = maturationAlignmentCounts(row);
    const tier = resolveAlignmentDisplayTier({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: row.state ?? row.label
    });
    if (tier === "near_ready" && row.last_transition_type === "improved") {
      newlyNearReady.push(symbol);
    }
  }

  improved.sort();
  weakened.sort();
  newlyNearReady.sort();
  return { improved, weakened, newlyNearReady };
}

function formatSymbolList(symbols: string[], max = 3): string {
  if (symbols.length === 0) return "";
  const head = symbols.slice(0, max);
  const rest = symbols.length - head.length;
  const base = head.join(", ");
  return rest > 0 ? `${base} +${rest}` : base;
}

/** Calm, progress-focused dashboard line — null when nothing notable. */
export function summarizeWatchlistDailyChanges(
  bySymbol: Record<string, WatchlistMaturationRow>
): string | null {
  const { improved, weakened, newlyNearReady } = collectWatchlistDailyChanges(bySymbol);
  const parts: string[] = [];

  if (newlyNearReady.length > 0) {
    const label =
      newlyNearReady.length === 1
        ? `${newlyNearReady[0]} moved closer to actionable`
        : `${newlyNearReady.length} symbols moved closer to actionable (${formatSymbolList(newlyNearReady)})`;
    parts.push(label);
  } else if (improved.length > 0) {
    const detail = improved
      .map((sym) => {
        const row = bySymbol[sym];
        const prog = formatWatchlistProgressionDetail(row);
        return prog ? `${sym} (${prog})` : sym;
      })
      .slice(0, 2);
    const more = improved.length - detail.length;
    const label =
      improved.length === 1
        ? `${detail[0]} improved`
        : `${detail.join(" · ")}${more > 0 ? ` · +${more} more` : ""} building`;
    parts.push(label);
  }

  if (weakened.length > 0) {
    const label =
      weakened.length === 1
        ? `${weakened[0]} lost structure`
        : `${weakened.length} symbols lost structure (${formatSymbolList(weakened)})`;
    parts.push(label);
  }

  if (parts.length === 0) return null;
  return parts.join(" · ");
}
