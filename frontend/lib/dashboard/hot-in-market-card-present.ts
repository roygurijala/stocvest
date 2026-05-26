/**
 * Hot in market — dashboard discovery card presentation.
 * @see docs/OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md §5.2
 */

import type { DeskDiscoveryLeader } from "@/lib/api/desk-today";
import { ACTIONABLE_ALIGNED_MIN } from "@/lib/alignment-display-tier";
import {
  dashboardDirectionCardChrome,
  type DashboardCardChrome,
  type DashboardCardTone
} from "@/lib/dashboard/dashboard-card-surface";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { formatDeskGapLine } from "@/lib/dashboard/desk-today-present";
import { alignedLayersFromAlignmentRatio } from "@/lib/signals-page-present";

export const HOT_IN_MARKET_TITLE = "Hot in market";

export const HOT_IN_MARKET_DISCLAIMER =
  "Ranked session movers from our platform scan — not trade recommendations. " +
  "Only symbols that pass our alignment, risk/reward, and execution gates are actionable on Signals.";

export type HotInMarketSource = "desk_cache" | "movers_radar" | "gap_fallback" | "empty";

export type HotInMarketSetupBadge =
  | "actionable"
  | "blocked"
  | "weak"
  | "review"
  | "pending"
  | "mover";

export type HotInMarketCardModel = {
  symbol: string;
  rank: number;
  gapLine: string;
  gapTone: "bullish" | "bearish" | "muted";
  priceLine: string | null;
  deskLabel: string;
  alignmentLine: string | null;
  layerDots: boolean[];
  layerTotal: number;
  verdictLine: string | null;
  detailLine: string | null;
  volumeLine: string | null;
  setupBadge: HotInMarketSetupBadge;
  setupBadgeLabel: string | null;
  cardTone: DashboardCardTone;
  cardChrome: DashboardCardChrome;
  peek: string;
};

export type HotInMarketThemeColors = {
  surface: string;
  border: string;
  accent: string;
  bullish: string;
  bearish: string;
  caution: string;
  textMuted: string;
};

const LAYER_TOTAL = 6;

const SETUP_BADGE_LABEL: Record<HotInMarketSetupBadge, string> = {
  actionable: "Meets our gates",
  blocked: "R/R blocks entry",
  weak: "Weak execution",
  review: "Review on Signals",
  pending: "Setup scan pending",
  mover: "Session mover"
};

export function leaderHasCompositeDetail(leader: DeskDiscoveryLeader): boolean {
  return (
    leader.alignment_ratio != null ||
    Boolean(leader.verdict?.trim()) ||
    Boolean(leader.execution_hint?.trim()) ||
    Boolean(leader.composite_status?.trim())
  );
}

function minRiskReward(mode: DashboardDeskMode): number {
  return mode === "day" ? 1.2 : 2.0;
}

function resolveSetupBadge(
  leader: DeskDiscoveryLeader,
  mode: DashboardDeskMode,
  source: HotInMarketSource
): HotInMarketSetupBadge {
  if (source === "movers_radar" || source === "gap_fallback") return "mover";
  if (!leaderHasCompositeDetail(leader)) return "pending";

  const hint = leader.execution_hint?.trim().toLowerCase() ?? "";
  if (hint.includes("risk/reward")) return "blocked";
  if (hint.includes("execution quality weak")) return "weak";

  const status = (leader.composite_status ?? "").trim().toLowerCase();
  if (status === "actionable") return "actionable";

  const aligned = alignedLayersFromAlignmentRatio(leader.alignment_ratio, LAYER_TOTAL);
  const rr = typeof leader.risk_reward === "number" ? leader.risk_reward : null;
  if (
    aligned != null &&
    aligned >= ACTIONABLE_ALIGNED_MIN &&
    rr != null &&
    rr >= minRiskReward(mode) &&
    !hint
  ) {
    return "actionable";
  }

  if (aligned != null || rr != null || leader.verdict?.trim()) return "review";
  return "mover";
}

function resolveSetupBadgeLabel(badge: HotInMarketSetupBadge): string | null {
  if (badge === "mover") return null;
  return SETUP_BADGE_LABEL[badge];
}

function formatDayVolume(volume: number | undefined): string | null {
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) return null;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M shares today`;
  if (volume >= 1_000) return `${Math.round(volume / 1_000)}K shares today`;
  return `${Math.round(volume).toLocaleString()} shares today`;
}

function formatPrice(price: number | undefined): string | null {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  return price >= 1000 ? `$${price.toFixed(0)}` : `$${price.toFixed(2)}`;
}

function truncateVerdict(verdict: string | null | undefined, max = 56): string | null {
  const t = verdict?.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function hotInMarketSourceSubtitle(
  source: HotInMarketSource,
  count: number
): string {
  if (count === 0) return "No ranked movers this load — check back after the next scan.";
  const noun = count === 1 ? "mover" : "movers";
  switch (source) {
    case "desk_cache":
      return `${count} ranked ${noun} · platform desk scan`;
    case "movers_radar":
      return `${count} session ${noun} · math-only movers until full desk scan`;
    case "gap_fallback":
      return `${count} gap ${noun} · desk cache warming`;
    default:
      return "";
  }
}

export function hotInMarketFeedSubtitle(input: {
  source: HotInMarketSource;
  count: number;
  deskLoading?: boolean;
  scannerPending?: boolean;
  mode: DashboardDeskMode;
}): string {
  const { source, count, deskLoading = false, scannerPending = false, mode } = input;
  if (count === 0) {
    if (deskLoading && scannerPending) {
      return "Loading platform desk and session movers…";
    }
    if (deskLoading) {
      return `Loading ${mode} desk scan…`;
    }
    if (scannerPending) {
      return "Loading session movers from scanner…";
    }
    return hotInMarketSourceSubtitle(source, count);
  }
  return hotInMarketSourceSubtitle(source, count);
}

export function buildHotInMarketCardModel(
  leader: DeskDiscoveryLeader,
  input: {
    rank: number;
    mode: DashboardDeskMode;
    source: HotInMarketSource;
    colors: HotInMarketThemeColors;
  }
): HotInMarketCardModel {
  const setupBadge = resolveSetupBadge(leader, input.mode, input.source);
  const setupBadgeLabel = resolveSetupBadgeLabel(setupBadge);
  const aligned = alignedLayersFromAlignmentRatio(leader.alignment_ratio, LAYER_TOTAL);
  const layerDots = Array.from({ length: LAYER_TOTAL }, (_, i) =>
    aligned != null ? i < aligned : false
  );
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

  let alignmentLine: string | null = null;
  if (aligned != null) {
    alignmentLine = `${aligned}/${LAYER_TOTAL} layers aligned`;
    const rr = typeof leader.risk_reward === "number" ? leader.risk_reward : null;
    if (rr != null && Number.isFinite(rr)) {
      alignmentLine += ` · ${rr.toFixed(1)}:1 R/R`;
    }
  }

  const verdictLine = truncateVerdict(leader.verdict);
  const volumeLine = formatDayVolume(leader.day_volume);
  const detailLine =
    alignmentLine || verdictLine
      ? null
      : setupBadge === "pending"
        ? "Ranked by session move · open Signals for full alignment and execution read"
        : volumeLine
          ? `${volumeLine} · open Signals for setup detail`
          : "Open Signals for alignment, R/R, and execution read";
  const peek =
    leader.execution_hint?.trim() ||
    verdictLine ||
    detailLine ||
    alignmentLine ||
    gapLine;

  return {
    symbol: leader.symbol,
    rank: input.rank,
    gapLine,
    gapTone,
    priceLine: formatPrice(leader.session_price),
    deskLabel: `${leader.desk} desk`,
    alignmentLine,
    layerDots,
    layerTotal: LAYER_TOTAL,
    verdictLine,
    detailLine,
    volumeLine,
    setupBadge,
    setupBadgeLabel,
    cardTone: gapTone,
    cardChrome,
    peek
  };
}

export function hotInMarketSignalsHref(symbol: string, mode: DashboardDeskMode): string {
  return `/dashboard/signals?symbol=${encodeURIComponent(symbol)}&trading_mode=${mode}&ref=dashboard`;
}
