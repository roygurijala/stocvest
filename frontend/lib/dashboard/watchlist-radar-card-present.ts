/**
 * Watchlist radar — compact dashboard cards (distinct from full watchlist page).
 */

import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import type { WatchlistRadarRow } from "@/lib/dashboard/watchlist-radar";
import {
  dashboardDirectionCardChrome,
  type DashboardCardChrome,
  type DashboardCardTone
} from "@/lib/dashboard/dashboard-card-surface";
import {
  watchlistAttentionSectionMeta,
  type WatchlistAttentionTier
} from "@/lib/watchlist-decision-card-present";

export const WATCHLIST_RADAR_TITLE = "Watchlist radar";

export const WATCHLIST_RADAR_DISCLAIMER =
  "Your tracked symbols that need a look today — not trade recommendations. " +
  "Open the full Watchlists page to manage tiers, refresh evaluations, and remove symbols.";

const TIER_BADGE: Record<WatchlistAttentionTier, string> = {
  check_now: "Check now",
  getting_close: "Getting close",
  tracking: "On your list"
};

export type WatchlistRadarCardModel = {
  symbol: string;
  attentionTier: WatchlistAttentionTier;
  badgeLabel: string;
  attentionLine: string;
  alignmentLine: string;
  quoteLine: string | null;
  quoteTone: "bullish" | "bearish" | "muted";
  layerDots: boolean[];
  layerTotal: number;
  cardTone: DashboardCardTone;
  cardChrome: DashboardCardChrome;
  peek: string;
};

export type WatchlistRadarThemeColors = {
  surface: string;
  border: string;
  accent: string;
  bullish: string;
  bearish: string;
  caution: string;
  textMuted: string;
};

function tierBadgeWhenMuted(tier: WatchlistAttentionTier): string {
  return TIER_BADGE[tier];
}

export function resolveWatchlistCardTone(input: {
  quoteBullish: boolean | null | undefined;
  sessionMovePct: number | null;
}): DashboardCardTone {
  if (input.quoteBullish === true) return "bullish";
  if (input.quoteBullish === false) return "bearish";
  if (input.sessionMovePct != null && Number.isFinite(input.sessionMovePct)) {
    if (input.sessionMovePct > 0) return "bullish";
    if (input.sessionMovePct < 0) return "bearish";
  }
  return "muted";
}

export function buildWatchlistRadarCardModel(
  row: WatchlistRadarRow,
  colors: WatchlistRadarThemeColors
): WatchlistRadarCardModel {
  const quoteTone = resolveWatchlistCardTone({
    quoteBullish: row.quote?.bullish,
    sessionMovePct: row.sessionMovePct
  });
  const cardChrome = dashboardDirectionCardChrome(quoteTone, {
    surface: colors.surface,
    border: colors.border,
    bullish: colors.bullish,
    bearish: colors.bearish,
    textMuted: colors.textMuted
  });
  const quoteLine =
    row.quote?.price && row.quote?.pct
      ? `${row.quote.price} ${row.quote.pct}`
      : row.quote?.price
        ? row.quote.price
        : row.quote?.pct
          ? row.quote.pct
          : null;

  return {
    symbol: row.symbol,
    attentionTier: row.attentionTier,
    badgeLabel: tierBadgeWhenMuted(row.attentionTier),
    attentionLine: row.attentionReason,
    alignmentLine: row.alignmentLine,
    quoteLine,
    quoteTone,
    layerDots: row.layerDots,
    layerTotal: row.total,
    cardTone: quoteTone,
    cardChrome,
    peek: row.blockers.length > 0 ? `Blocked: ${row.blockers.join(" · ")}` : row.attentionReason
  };
}

export function watchlistRadarSignalsHref(symbol: string, mode: DashboardDeskMode): string {
  return `/dashboard/signals?symbol=${encodeURIComponent(symbol)}&trading_mode=${mode}&ref=dashboard`;
}

export function watchlistRadarSectionMeta(tier: WatchlistAttentionTier) {
  return watchlistAttentionSectionMeta(tier);
}
