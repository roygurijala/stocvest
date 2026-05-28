/**
 * Market activity — dashboard discovery card presentation (session movers, not signals).
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

/** @deprecated Use MARKET_ACTIVITY_TITLE — kept for imports/tests */
export const HOT_IN_MARKET_TITLE = "Market activity";

export const MARKET_ACTIVITY_TITLE = "Market activity";

export const MARKET_ACTIVITY_SUBTITLE =
  "Session movers from our platform scan — momentum and context only, not entries.";

export const HOT_IN_MARKET_DISCLAIMER =
  "Not trade recommendations. Most rows are not actionable until alignment, risk/reward, and execution clear on Signals.";

export const MARKET_ACTIVITY_DISCLAIMER = HOT_IN_MARKET_DISCLAIMER;

export type HotInMarketGapEmphasis = "primary" | "secondary";

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
  gapEmphasis: HotInMarketGapEmphasis;
  priceLine: string | null;
  deskLabel: string;
  statusHeadline: string;
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
  mover: "Session mover · not an entry"
};

export function resolveHotInMarketGapEmphasis(setupBadge: HotInMarketSetupBadge): HotInMarketGapEmphasis {
  return setupBadge === "actionable" ? "primary" : "secondary";
}

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
  return SETUP_BADGE_LABEL[badge];
}

function resolveStatusHeadline(input: {
  setupBadge: HotInMarketSetupBadge;
  setupBadgeLabel: string | null;
  alignmentLine: string | null;
  verdictLine: string | null;
  executionHint: string | null;
  source: HotInMarketSource;
}): string {
  if (input.setupBadge === "mover" || input.source === "movers_radar" || input.source === "gap_fallback") {
    return "Momentum move — open Signals for structure and gates";
  }
  if (input.setupBadge === "blocked") {
    return input.executionHint?.trim() || "Strong move — execution blocked by desk gates";
  }
  if (input.setupBadge === "weak") {
    return "Setup forming — execution quality weak";
  }
  if (input.setupBadge === "pending") {
    return "Ranked by session move — full desk scan still loading";
  }
  if (input.setupBadgeLabel && input.setupBadge !== "actionable") {
    return input.setupBadgeLabel;
  }
  if (input.alignmentLine) return input.alignmentLine;
  if (input.verdictLine) return input.verdictLine;
  return "Open Signals for alignment and execution read";
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
  deskCacheMiss?: boolean;
  mode: DashboardDeskMode;
}): string {
  const {
    source,
    count,
    deskLoading = false,
    scannerPending = false,
    deskCacheMiss = false,
    mode
  } = input;
  if (count > 0) {
    const base = hotInMarketSourceSubtitle(source, count);
    if (scannerPending && (source === "desk_cache" || source === "movers_radar")) {
      return `${base} · scanner still enriching gaps`;
    }
    return base;
  }
  if (deskLoading && scannerPending) {
    return "Loading platform desk and session movers…";
  }
  if (deskLoading) {
    return `Loading ${mode} desk scan…`;
  }
  if (scannerPending && deskCacheMiss) {
    return "Desk cache empty — waiting on scanner or use Refresh desk";
  }
  if (scannerPending) {
    return "Loading session movers from scanner…";
  }
  if (deskCacheMiss) {
    return "No cached movers yet — Refresh desk runs a live scan";
  }
  return hotInMarketSourceSubtitle(source, count);
}

export function hotInMarketAwaitingMessage(input: {
  deskLoading?: boolean;
  scannerPending?: boolean;
  deskCacheMiss?: boolean;
}): string {
  const { deskLoading = false, scannerPending = false, deskCacheMiss = false } = input;
  if (deskLoading && scannerPending) {
    return "Hang tight — platform desk and scanner are still loading.";
  }
  if (deskLoading) {
    return "Hang tight — loading the latest desk scan.";
  }
  if (scannerPending && deskCacheMiss) {
    return "Desk cache is empty. Use Refresh desk for an immediate scan, or wait for the scanner to finish.";
  }
  if (scannerPending) {
    return "Hang tight — session movers appear once the scanner finishes.";
  }
  return "Hang tight — movers appear here once data is available.";
}

export function hotInMarketEmptyMessage(deskCacheMiss: boolean): string {
  if (deskCacheMiss) {
    return "Session movers are not cached yet for this desk. We can load them now (one scan per few minutes), or they will appear after the next scheduled platform scan.";
  }
  return "No ranked movers this load — the session may be quiet or filters may have cleared the list.";
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
  const gapEmphasis = resolveHotInMarketGapEmphasis(setupBadge);
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
  const statusHeadline = resolveStatusHeadline({
    setupBadge,
    setupBadgeLabel,
    alignmentLine,
    verdictLine,
    executionHint: leader.execution_hint ?? null,
    source: input.source
  });
  const detailLine =
    alignmentLine && gapEmphasis === "secondary"
      ? null
      : setupBadge === "pending"
        ? volumeLine ?? null
        : volumeLine && !alignmentLine
          ? volumeLine
          : null;
  const peek =
    leader.execution_hint?.trim() ||
    statusHeadline ||
    alignmentLine ||
    verdictLine ||
    gapLine;

  return {
    symbol: leader.symbol,
    rank: input.rank,
    gapLine,
    gapTone,
    gapEmphasis,
    priceLine: formatPrice(leader.session_price),
    deskLabel: `${leader.desk} desk`,
    statusHeadline,
    alignmentLine,
    layerDots,
    layerTotal: LAYER_TOTAL,
    verdictLine: gapEmphasis === "primary" ? verdictLine : null,
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
