/**
 * ADR-002 UX-2 — swing setup ranked table presentation.
 *
 * Market mode: read-mostly from cached swing desk (discovery + quiet leaders).
 * Watchlist mode (legacy): watchlist maturation + desk overlay.
 */
import type { DeskDiscoveryLeader, DeskQuietLeader, DeskTodayData } from "@/lib/api/desk-today";
import { formatWatchlistMaturationDisplayLine } from "@/lib/alignment-display-tier";
import { resolveRiskReward } from "@/lib/dashboard/hot-in-market-card-present";
import {
  FEED_STATE_LABEL,
  presentDeskLeaderBias,
  presentDeskLeaderState,
  presentDeskLeaderVerdict,
  type FeedBias,
  type FeedState
} from "@/lib/dashboard/trading-room/feed-model";
import { feedCardStateLabel } from "@/lib/dashboard/trading-room/feed-state-present";
import {
  groupSymbolsIntoAttentionTiers,
  sortSymbolsInAttentionTier,
  type WatchlistAttentionTier
} from "@/lib/watchlist-decision-card-present";
import { missingLayerNames } from "@/lib/watchlist-alignment-present";
import { dedupeWatchlistSymbolsUpper, formatWatchlistMaturationLabel, type WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export type PersonalRankedRow = {
  symbol: string;
  readiness: string;
  direction: string;
  riskReward: string | null;
  state: string;
  why: string;
  attentionTier?: WatchlistAttentionTier;
  feedState: FeedState;
  bias: FeedBias;
};

export type BuildPersonalRankedRowsInput = {
  watchlistSymbols: readonly string[];
  swingBySymbol: Record<string, WatchlistMaturationRow>;
  swingDesk: DeskTodayData | null | undefined;
};

type DeskLeader = DeskDiscoveryLeader | DeskQuietLeader;

const FEED_STATE_ORDER: Record<FeedState, number> = {
  actionable: 0,
  near: 1,
  potential: 2,
  cooling: 3
};

function indexSwingDeskLeaders(desk: DeskTodayData | null | undefined): Map<string, DeskLeader> {
  const map = new Map<string, DeskLeader>();
  for (const leader of desk?.discovery ?? []) {
    const sym = leader.symbol.trim().toUpperCase();
    if (!sym || leader.desk_surface_eligible === false) continue;
    map.set(sym, leader);
  }
  for (const leader of desk?.quiet_leaders ?? []) {
    const sym = leader.symbol.trim().toUpperCase();
    if (!sym || leader.desk_surface_eligible === false) continue;
    if (!map.has(sym)) map.set(sym, leader);
  }
  return map;
}

/** Desk discovery + quiet leaders only (no watchlist). */
export function collectMarketSwingSymbols(desk: DeskTodayData | null | undefined): string[] {
  return Array.from(indexSwingDeskLeaders(desk).keys());
}

export function collectPersonalRankedSymbols(input: BuildPersonalRankedRowsInput): string[] {
  const leaders = indexSwingDeskLeaders(input.swingDesk);
  return dedupeWatchlistSymbolsUpper([
    ...input.watchlistSymbols,
    ...Object.keys(input.swingBySymbol),
    ...Array.from(leaders.keys())
  ]);
}

function formatDirectionLabel(
  leader: DeskLeader | undefined,
  maturation: WatchlistMaturationRow | undefined
): string {
  const confidence = leader?.direction_confidence?.trim();
  const bias = leader ? presentDeskLeaderBias(leader) : maturationBias(maturation);
  const biasLabel = bias === "bull" ? "Long" : bias === "bear" ? "Short" : "Neutral";
  if (confidence) return `${confidence} · ${biasLabel}`;
  if (maturation?.bias?.trim()) {
    const b = maturation.bias.trim().toLowerCase();
    if (b.includes("long") || b.includes("bull")) return "Long";
    if (b.includes("short") || b.includes("bear")) return "Short";
    if (b.includes("neutral")) return "Neutral";
  }
  return biasLabel;
}

function maturationBias(row: WatchlistMaturationRow | undefined): FeedBias {
  const b = (row?.bias ?? "").trim().toLowerCase();
  if (/\b(long|bull)\b/.test(b)) return "bull";
  if (/\b(short|bear)\b/.test(b)) return "bear";
  return "neutral";
}

function maturationFeedState(row: WatchlistMaturationRow | undefined): FeedState {
  const st = (row?.state ?? row?.label ?? "").trim().toLowerCase();
  if (st === "actionable") return "actionable";
  if (st === "developing" || st === "monitor") return "near";
  if (st === "invalidated" || st === "cooling") return "cooling";
  return "potential";
}

function resolveReadiness(
  maturation: WatchlistMaturationRow | undefined,
  leader: DeskLeader | undefined
): string {
  const fromMaturation = formatWatchlistMaturationDisplayLine(maturation);
  if (fromMaturation) return fromMaturation;
  const ratio = leader?.alignment_ratio;
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    const aligned = Math.round(ratio * 6);
    return `${aligned}/6 aligned`;
  }
  return "Not evaluated";
}

function resolveRiskRewardLabel(
  leader: DeskLeader | undefined,
  maturation: WatchlistMaturationRow | undefined
): string | null {
  const rr = leader
    ? resolveRiskReward(leader.risk_reward, leader.execution_hint, leader.structure_risk_reward)
    : null;
  if (rr != null && Number.isFinite(rr)) return `${rr.toFixed(1)}:1`;
  const readiness = (maturation?.readiness_label ?? "").trim();
  const match = readiness.match(/(\d+(?:\.\d+)?)\s*:\s*1/);
  if (match) return `${match[1]}:1`;
  return null;
}

function resolveWhyLine(
  leader: DeskLeader | undefined,
  maturation: WatchlistMaturationRow | undefined
): string {
  const geo = leader?.geometry_block_reason?.trim();
  if (geo) return geo;
  const quietWhy = "why_line" in (leader ?? {}) ? (leader as DeskQuietLeader).why_line?.trim() : null;
  if (quietWhy) return quietWhy;
  const hint = leader?.execution_hint?.trim();
  if (hint && !/^monitor/i.test(hint)) return hint;
  const verdict = leader ? presentDeskLeaderVerdict(leader) : null;
  if (verdict && verdict !== "Monitoring conditions") return verdict;
  const missing = missingLayerNames(maturation).filter((n) => n !== "Remaining confirmation layers");
  if (missing.length > 0) return `Waiting on ${missing.slice(0, 2).join(", ")}`;
  const readiness = (maturation?.readiness_label ?? "").trim();
  if (readiness && readiness.length < 100) {
    const trimmed = readiness.replace(/^Why hold:\s*/i, "").trim();
    if (trimmed) return trimmed.split(/[.—]/)[0]?.trim() || trimmed;
  }
  return "Monitoring";
}

function resolveStateLabel(
  leader: DeskLeader | undefined,
  maturation: WatchlistMaturationRow | undefined,
  feedState: FeedState
): string {
  if (leader) {
    return feedCardStateLabel({
      id: `swing:${leader.symbol}`,
      symbol: leader.symbol,
      company: null,
      lane: "swing",
      state: feedState,
      bias: presentDeskLeaderBias(leader),
      verdict: presentDeskLeaderVerdict(leader),
      phase: leader.composite_status?.trim() || null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 0,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    });
  }
  const matLabel = formatWatchlistMaturationLabel(maturation);
  if (matLabel && matLabel !== "Monitoring") return matLabel;
  return FEED_STATE_LABEL[feedState];
}

function buildRow(
  symbol: string,
  maturation: WatchlistMaturationRow | undefined,
  leader: DeskLeader | undefined,
  attentionTier?: WatchlistAttentionTier
): PersonalRankedRow {
  const feedState = leader ? presentDeskLeaderState(leader) : maturationFeedState(maturation);
  const bias = leader ? presentDeskLeaderBias(leader) : maturationBias(maturation);
  return {
    symbol,
    readiness: resolveReadiness(maturation, leader),
    direction: formatDirectionLabel(leader, maturation),
    riskReward: resolveRiskRewardLabel(leader, maturation),
    state: resolveStateLabel(leader, maturation, feedState),
    why: resolveWhyLine(leader, maturation),
    attentionTier,
    feedState,
    bias
  };
}

function buildMarketRow(leader: DeskLeader): PersonalRankedRow {
  const symbol = leader.symbol.trim().toUpperCase();
  return buildRow(symbol, undefined, leader);
}

function rankScore(leader: DeskLeader): number {
  return typeof leader.rank_score === "number" && Number.isFinite(leader.rank_score) ? leader.rank_score : 0;
}

/** Rank swing desk discovery + quiet leaders for the market-sourced table. */
export function buildMarketSwingRankedRows(swingDesk: DeskTodayData | null | undefined): PersonalRankedRow[] {
  const leaders = indexSwingDeskLeaders(swingDesk);
  const ordered = Array.from(leaders.values()).sort((a, b) => {
    const byState = FEED_STATE_ORDER[presentDeskLeaderState(a)] - FEED_STATE_ORDER[presentDeskLeaderState(b)];
    if (byState !== 0) return byState;
    if (rankScore(b) !== rankScore(a)) return rankScore(b) - rankScore(a);
    return a.symbol.localeCompare(b.symbol);
  });
  return ordered.map(buildMarketRow);
}

/** Rank watchlist + desk symbols into table rows (attention tier order). */
export function buildPersonalRankedRows(input: BuildPersonalRankedRowsInput): PersonalRankedRow[] {
  const symbols = collectPersonalRankedSymbols(input);
  if (symbols.length === 0) return [];

  const leaders = indexSwingDeskLeaders(input.swingDesk);
  const rowForSymbol = (sym: string) => input.swingBySymbol[sym];
  const buckets = groupSymbolsIntoAttentionTiers(symbols, rowForSymbol);
  const ordered = [
    ...sortSymbolsInAttentionTier(buckets.check_now, rowForSymbol),
    ...sortSymbolsInAttentionTier(buckets.getting_close, rowForSymbol),
    ...sortSymbolsInAttentionTier(buckets.tracking, rowForSymbol)
  ];

  const seen = new Set<string>();
  const out: PersonalRankedRow[] = [];
  for (const sym of ordered) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    const maturation = rowForSymbol(sym);
    const tier =
      buckets.check_now.includes(sym)
        ? ("check_now" as const)
        : buckets.getting_close.includes(sym)
          ? ("getting_close" as const)
          : ("tracking" as const);
    out.push(buildRow(sym, maturation, leaders.get(sym), tier));
  }
  return out;
}
