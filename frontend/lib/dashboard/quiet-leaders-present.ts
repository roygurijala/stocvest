/**
 * Quiet leaders — low-velocity, strong swing structure (dashboard + scanner).
 */

import type { DeskQuietLeader, DeskTodayMode } from "@/lib/api/desk-today";
import {
  dashboardDirectionCardChrome,
  type DashboardCardChrome,
  type DashboardCardTone
} from "@/lib/dashboard/dashboard-card-surface";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { formatDeskGapLine } from "@/lib/dashboard/desk-today-present";
import { alignedLayersFromAlignmentRatio } from "@/lib/signals-page-present";
import {
  hotInMarketSignalsHref,
  resolveCompactStatusHeadline,
  resolveHotInMarketGapEmphasis,
  resolveRiskReward,
  type HotInMarketCardModel,
  type HotInMarketThemeColors
} from "@/lib/dashboard/hot-in-market-card-present";

export const QUIET_LEADERS_TITLE = "Quiet leaders";
export const QUIET_LEADERS_SUBTITLE =
  "Strong swing structure with low session velocity — often before names show up in market activity.";
export const QUIET_LEADERS_DISCLAIMER =
  "Structure-ranked from a broad scan — not trade recommendations. Confirm on the Signals desk before sizing.";

const LAYER_TOTAL = 6;

export function quietLeadersFromDesk(data: { quiet_leaders?: DeskQuietLeader[] } | null | undefined): DeskQuietLeader[] {
  const raw = data?.quiet_leaders;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      ...row,
      symbol: String(row.symbol ?? "")
        .trim()
        .toUpperCase()
    }))
    .filter((r) => r.symbol.length > 0)
    .slice(0, 8);
}

export function buildQuietLeaderCardModel(
  leader: DeskQuietLeader,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    colors: HotInMarketThemeColors;
  }
): HotInMarketCardModel {
  const gapLine = formatDeskGapLine(leader.gap_percent, leader.direction);
  const gapTone: DashboardCardTone =
    leader.direction === "up" ? "bullish" : leader.direction === "down" ? "bearish" : "muted";
  const cardChrome = dashboardDirectionCardChrome(gapTone, {
    surface: input.colors.surface,
    border: input.colors.border,
    bullish: input.colors.bullish,
    bearish: input.colors.bearish,
    textMuted: input.colors.textMuted
  });
  const aligned = alignedLayersFromAlignmentRatio(leader.alignment_ratio, LAYER_TOTAL);
  const layerDots = Array.from({ length: LAYER_TOTAL }, (_, i) => (aligned != null ? i < aligned : false));
  const rsi =
    typeof leader.daily_rsi === "number" && Number.isFinite(leader.daily_rsi) ? leader.daily_rsi : null;
  const why = leader.why_line?.trim() || (rsi != null ? `RSI ${rsi.toFixed(0)} · low velocity` : "Low velocity · structure");
  const alignmentLine = aligned != null ? `${aligned}/${LAYER_TOTAL} layers aligned` : null;
  const riskReward = resolveRiskReward(leader.risk_reward, leader.execution_hint);
  const hint = leader.execution_hint?.trim().toLowerCase() ?? "";
  const setupBadge = hint.includes("risk/reward") ? ("blocked" as const) : ("review" as const);
  const setupBadgeLabel = setupBadge === "blocked" ? "R/R blocks entry" : "Quiet leader";
  const gapEmphasis = resolveHotInMarketGapEmphasis(setupBadge);
  const statusHeadline = resolveCompactStatusHeadline({
    setupBadge,
    source: "desk_cache",
    aligned,
    riskReward,
    executionHint: leader.execution_hint ?? null,
    sessionMode: "live",
    quietLeader: true
  });

  return {
    symbol: leader.symbol,
    rank: input.rank,
    gapLine,
    gapTone,
    gapEmphasis,
    priceLine: null,
    deskLabel: "swing · under the surface",
    statusHeadline,
    alignmentLine,
    layerDots,
    layerTotal: LAYER_TOTAL,
    verdictLine: leader.verdict?.trim() || null,
    detailLine: why,
    volumeLine: null,
    setupBadge,
    setupBadgeLabel,
    cardTone: gapTone,
    cardChrome,
    peek: leader.execution_hint?.trim() || why
  };
}

export { hotInMarketSignalsHref as quietLeaderSignalsHref };

export function quietLeadersScannerHref(mode: DeskTodayMode = "swing"): string {
  return `/dashboard/scanner?mode=${mode}#scanner-quiet-leaders`;
}
