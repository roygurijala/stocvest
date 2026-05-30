/**
 * Watchlist decision-queue presentation — tiering, card copy, and border accents.
 */

import {
  formatAlignmentStatusLine,
  formatWatchlistProgressionDetail,
  resolveAlignmentDisplayTier,
  type AlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { maturationAlignmentCounts, missingLayerNames } from "@/lib/watchlist-alignment-present";
import { readinessDuplicatesAlignmentCount } from "@/lib/watchlist-row-present";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import type { SnapshotPayload } from "@/lib/api/market";
import { watchlistQuoteFromSnapshot } from "@/lib/watchlist-page-utils";
import { sortWatchlistSymbolsInTier } from "@/lib/watchlist-sort-preference";
import {
  parseRiskRewardFromReadiness,
  resolveTradeConvictionTier,
  type TradeConvictionTierResult
} from "@/lib/trade-conviction-tier";
import {
  isWatchlistRadarDeskGated,
  resolveWatchlistRadarAttentionLine,
  WATCHLIST_DESK_OPEN,
  type WatchlistRadarDeskContext
} from "@/lib/dashboard/watchlist-radar-attention";
import {
  resolveWatchlistCardChrome,
  type WatchlistCardChromeKind,
  type WatchlistDirectionChip
} from "@/lib/watchlist-card-chrome";

export type WatchlistAttentionTier = "check_now" | "getting_close" | "tracking";

export type { WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar-attention";
export { WATCHLIST_DESK_OPEN } from "@/lib/dashboard/watchlist-radar-attention";

export type WatchlistCardModel = {
  symbol: string;
  row: WatchlistMaturationRow | undefined;
  aligned: number;
  total: number;
  alignmentTier: AlignmentDisplayTier;
  attentionTier: WatchlistAttentionTier;
  alignmentLine: string;
  /** Desk-aware status line (layers vs desk gating); shown as primary card subline. */
  attentionLine: string | null;
  momentumLine: string | null;
  progressionBadge: "improved" | "weakened" | null;
  blockers: string[];
  evaluatedAgo: string;
  evaluatedStale: boolean;
  quote: { price: string; pct: string | null; bullish: boolean | null } | null;
  layerDots: boolean[];
  borderLeft: string;
  borderBottom: string;
  chromeKind: WatchlistCardChromeKind;
  dotAccent: string;
  chromeBadgeLabel: string;
  chromeBadgeColor: string;
  chromeBadgeBackground: string;
  directionChip: WatchlistDirectionChip | null;
  statusBanner: string | null;
  conviction: TradeConvictionTierResult | null;
};

const TIER_SECTION: Record<
  WatchlistAttentionTier,
  { title: string; subtitle: string; icon: string }
> = {
  check_now: {
    title: "Check now",
    subtitle: "Worth opening on Signals",
    icon: "●"
  },
  getting_close: {
    title: "Getting close",
    subtitle: "Building — monitor progression",
    icon: "◐"
  },
  tracking: {
    title: "Tracking",
    subtitle: "Lower priority today",
    icon: "○"
  }
};

export function watchlistAttentionSectionMeta(tier: WatchlistAttentionTier) {
  return TIER_SECTION[tier];
}

export function resolveWatchlistAttentionTier(row: WatchlistMaturationRow | undefined): WatchlistAttentionTier {
  if (!row?.state && !row?.label && row?.layers_aligned == null) return "tracking";
  const { aligned, total } = maturationAlignmentCounts(row);
  const displayTier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: row.state ?? row.label
  });
  if (displayTier === "actionable" || displayTier === "near_ready") return "check_now";
  if (displayTier === "developing" || aligned >= 2) return "getting_close";
  return "tracking";
}

function progressionBadge(
  row: WatchlistMaturationRow | undefined
): WatchlistCardModel["progressionBadge"] {
  if (row?.last_transition_type === "improved") return "improved";
  if (row?.last_transition_type === "worsened") return "weakened";
  return null;
}

function buildMomentumLine(
  row: WatchlistMaturationRow | undefined,
  opts: {
    attentionTier: WatchlistAttentionTier;
    attentionLine: string | null;
    sessionMode?: SessionActivityUiMode;
  }
): string | null {
  if (
    opts.attentionLine &&
    (opts.sessionMode === "closed" || opts.sessionMode === "extended") &&
    (opts.attentionTier === "check_now" || opts.attentionTier === "getting_close")
  ) {
    return opts.attentionLine;
  }
  const detail = formatWatchlistProgressionDetail(row);
  if (detail) {
    const type = row?.last_transition_type;
    if (type === "improved") return `Building momentum ↑ (${detail})`;
    if (type === "worsened") return `Losing momentum ↓ (${detail})`;
    return detail;
  }
  if (
    opts.attentionLine &&
    (opts.attentionTier === "check_now" || opts.attentionTier === "getting_close")
  ) {
    return opts.attentionLine;
  }
  const { aligned, total } = maturationAlignmentCounts(row);
  const tier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: row?.state
  });
  if (tier === "developing") return "Building momentum";
  if (tier === "not_aligned") return "Early stage";
  return null;
}

function readinessIsAlignmentSummary(
  readiness: string,
  aligned: number,
  total: number
): boolean {
  const r = readiness.trim();
  if (!r) return false;
  if (readinessDuplicatesAlignmentCount(r, aligned, total)) return true;
  const lower = r.toLowerCase();
  if (/\b\d+\s*\/\s*\d+\s+aligned\b/.test(lower)) return true;
  if (/\b\d+\s+of\s+\d+\s+aligned\b/.test(lower)) return true;
  if (/^strong\b/.test(lower) && lower.includes("aligned")) return true;
  return false;
}

function extractBlockers(row: WatchlistMaturationRow | undefined): string[] {
  const { aligned, total } = maturationAlignmentCounts(row);
  const fromMissing = missingLayerNames(row).filter(
    (n) => n !== "Remaining confirmation layers"
  );
  if (fromMissing.length > 0) return fromMissing.slice(0, 2);
  const readiness = (row?.readiness_label ?? "").trim();
  if (!readiness) return [];
  if (readinessIsAlignmentSummary(readiness, aligned, total)) return [];
  const blockers: string[] = [];
  const lower = readiness.toLowerCase();
  if (lower.includes("risk/reward") || lower.includes("risk reward")) blockers.push("Risk/Reward");
  if (lower.includes("volume")) blockers.push("Volume");
  if (lower.includes("macro") || lower.includes("regime")) blockers.push("Macro");
  if (lower.includes("confirmation") || lower.includes("mixed")) blockers.push("Confirmation");
  if (lower.includes("data") || lower.includes("coverage")) blockers.push("Data");
  if (blockers.length === 0 && readiness.length < 80) {
    const trimmed = readiness.replace(/^Why hold:\s*/i, "").split(/[.—]/)[0]?.trim();
    if (
      trimmed &&
      trimmed.length < 60 &&
      !readinessIsAlignmentSummary(trimmed, aligned, total)
    ) {
      blockers.push(trimmed);
    }
  }
  return blockers.slice(0, 2);
}

export function formatEvaluatedAgo(iso: string | undefined): { text: string; stale: boolean } {
  if (!iso?.trim()) return { text: "Not evaluated", stale: true };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { text: "Not evaluated", stale: true };
  const diffMin = Math.floor((Date.now() - t) / 60_000);
  if (diffMin < 1) return { text: "just now", stale: false };
  if (diffMin < 60) return { text: `${diffMin}m ago`, stale: diffMin >= 45 };
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return { text: `${diffH}h ago`, stale: true };
  const diffD = Math.floor(diffH / 24);
  return { text: `${diffD}d ago`, stale: true };
}

function resolveWatchlistConviction(
  row: WatchlistMaturationRow | undefined,
  aligned: number,
  total: number,
  mode: "swing" | "day"
): TradeConvictionTierResult | null {
  const rr = parseRiskRewardFromReadiness(row?.readiness_label);
  if (rr == null) return null;
  const tier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: row?.state
  });
  const decisionState =
    tier === "actionable" ? "actionable" : tier === "not_aligned" || tier === "invalidated" ? "blocked" : "monitor";
  return resolveTradeConvictionTier({
    mode,
    riskReward: rr,
    layersAligned: aligned,
    layersTotal: total,
    decisionState
  });
}

export function buildWatchlistCardModel(
  symbol: string,
  row: WatchlistMaturationRow | undefined,
  snapshot: SnapshotPayload | undefined,
  colors: { accent: string; bullish: string; bearish: string; caution: string; textMuted: string },
  planMode: "swing" | "day" = "swing",
  desk: WatchlistRadarDeskContext = WATCHLIST_DESK_OPEN
): WatchlistCardModel {
  const symU = symbol.trim().toUpperCase();
  const { aligned, total } = maturationAlignmentCounts(row);
  const alignmentTier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: row?.state
  });
  const attentionTier = resolveWatchlistAttentionTier(row);
  const layerDots = Array.from({ length: total }, (_, i) => i < aligned);
  const evalAgo = formatEvaluatedAgo(row?.last_evaluated_at);
  const blockers = extractBlockers(row);
  const attentionLine = resolveWatchlistRadarAttentionLine({
    tier: attentionTier,
    row,
    alignmentTier,
    blockers,
    desk
  });
  const chrome = resolveWatchlistCardChrome({
    alignmentTier,
    row,
    blockers,
    desk,
    planMode,
    colors,
    attentionTier
  });

  return {
    symbol: symU,
    row,
    aligned,
    total,
    alignmentTier,
    attentionTier,
    alignmentLine: formatAlignmentStatusLine({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: row?.state,
      bias: row?.bias
    }),
    attentionLine,
    momentumLine: buildMomentumLine(row, {
      attentionTier,
      attentionLine,
      sessionMode: desk.sessionMode
    }),
    progressionBadge: progressionBadge(row),
    blockers,
    evaluatedAgo: evalAgo.text,
    evaluatedStale: evalAgo.stale,
    quote: watchlistQuoteFromSnapshot(snapshot),
    layerDots,
    borderLeft: chrome.borderLeft,
    borderBottom: chrome.borderBottom,
    chromeKind: chrome.kind,
    dotAccent: chrome.dotAccent,
    chromeBadgeLabel: chrome.badgeLabel,
    chromeBadgeColor: chrome.badgeColor,
    chromeBadgeBackground: chrome.badgeBackground,
    directionChip: chrome.directionChip,
    statusBanner: chrome.statusBanner,
    conviction: resolveWatchlistConviction(row, aligned, total, planMode)
  };
}

export function groupSymbolsIntoAttentionTiers(
  symbols: string[],
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined
): Record<WatchlistAttentionTier, string[]> {
  const buckets: Record<WatchlistAttentionTier, string[]> = {
    check_now: [],
    getting_close: [],
    tracking: []
  };
  for (const sym of symbols) {
    const symU = sym.trim().toUpperCase();
    if (!symU) continue;
    const tier = resolveWatchlistAttentionTier(rowForSymbol(symU));
    buckets[tier].push(symU);
  }
  return buckets;
}

/** Sort within tier: higher alignment first, then improving transitions. */
export function sortSymbolsInAttentionTier(
  symbols: string[],
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined
): string[] {
  return sortWatchlistSymbolsInTier(symbols, "attention", rowForSymbol);
}

/** Short tier-specific preview appended to section headers, e.g. "2 near actionable". */
export function buildWatchlistTierPreview(
  tier: WatchlistAttentionTier,
  symbols: string[],
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined,
  desk: WatchlistRadarDeskContext = WATCHLIST_DESK_OPEN
): string | null {
  if (symbols.length === 0) return null;

  let actionable = 0;
  let nearReady = 0;
  let deskGatedStrong = 0;
  let deskGatedNear = 0;
  let improved = 0;
  let early = 0;
  const deskGated = isWatchlistRadarDeskGated(desk);

  for (const sym of symbols) {
    const row = rowForSymbol(sym);
    const { aligned, total } = maturationAlignmentCounts(row);
    const displayTier = resolveAlignmentDisplayTier({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: row?.state ?? row?.label
    });
    if (displayTier === "actionable") {
      if (deskGated) deskGatedStrong += 1;
      else actionable += 1;
    } else if (displayTier === "near_ready") {
      if (deskGated) deskGatedNear += 1;
      else nearReady += 1;
    }
    if (row?.last_transition_type === "improved") improved += 1;
    if (displayTier === "not_aligned" || aligned <= 1) early += 1;
  }

  if (tier === "check_now") {
    const parts: string[] = [];
    if (deskGatedStrong > 0) {
      parts.push(
        deskGatedStrong === 1 ? "1 desk gated" : `${deskGatedStrong} desk gated`
      );
    }
    if (actionable > 0) parts.push(`${actionable} actionable`);
    if (deskGatedNear > 0) {
      parts.push(deskGatedNear === 1 ? "1 near ready, desk gated" : `${deskGatedNear} near ready, desk gated`);
    }
    if (nearReady > 0) parts.push(`${nearReady} near actionable`);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  if (tier === "getting_close") {
    if (improved > 0) {
      return improved === 1 ? "1 improved recently" : `${improved} improved recently`;
    }
    return null;
  }

  if (early >= symbols.length) return "mostly early stage";
  if (early > 0) return early === 1 ? "1 early stage" : `${early} early stage`;
  return null;
}

export function formatWatchlistTierHeaderHint(
  tier: WatchlistAttentionTier,
  count: number,
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined,
  symbolsInTier: string[],
  desk: WatchlistRadarDeskContext = WATCHLIST_DESK_OPEN
): string {
  const meta = watchlistAttentionSectionMeta(tier);
  const countLabel = count === 1 ? "1 symbol" : `${count} symbols`;
  const preview = buildWatchlistTierPreview(tier, symbolsInTier, rowForSymbol, desk);
  const parts = [countLabel, meta.subtitle];
  if (desk.sessionMode === "closed") {
    parts.push("Market closed — cards show structure, not live entries");
  } else if (desk.sessionMode === "extended") {
    parts.push("Extended hours — context only until regular open");
  }
  if (preview) parts.push(preview);
  return parts.join(" · ");
}
