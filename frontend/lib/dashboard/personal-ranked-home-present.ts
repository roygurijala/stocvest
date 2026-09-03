/**
 * ADR-002 UX-2 — swing setup ranked table presentation.
 *
 * Market mode: read-mostly from cached swing desk (discovery + quiet leaders).
 * When geometry-eligible desk rows are empty, falls back to developing desk rows,
 * scanner swing setups, then building-structure near-ready rows.
 */
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { DeskDiscoveryLeader, DeskQuietLeader, DeskTodayData } from "@/lib/api/desk-today";
import { formatWatchlistMaturationDisplayLine } from "@/lib/alignment-display-tier";
import { resolveRiskReward } from "@/lib/dashboard/hot-in-market-card-present";
import {
  presentDeskLeaderBias,
  presentDeskLeaderState,
  presentDeskLeaderVerdict,
  type FeedBias,
  type FeedState
} from "@/lib/dashboard/trading-room/feed-model";
import { FEED_STATE_LABEL, feedCardStateLabel } from "@/lib/dashboard/trading-room/feed-state-present";
import {
  groupSymbolsIntoAttentionTiers,
  sortSymbolsInAttentionTier,
  type WatchlistAttentionTier
} from "@/lib/watchlist-decision-card-present";
import { missingLayerNames } from "@/lib/watchlist-alignment-present";
import { dedupeWatchlistSymbolsUpper, formatWatchlistMaturationLabel, type WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  resolveBuildingStructureRows,
  type BuildingStructureRow
} from "@/lib/dashboard/building-structure-present";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";

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

export type BuildMarketSwingRankedRowsInput = {
  swingDesk: DeskTodayData | null | undefined;
  /** Scanner swing qualifying setups — fallback when desk leaders are empty. */
  swingSetups?: readonly IntradaySetupPayload[];
  /** Near-qualification swing rows from scan summary — last-resort fallback. */
  nearQualification?: readonly ScannerNearQualificationRow[];
};

/** Which data tier populated the market swing table (for honest UX copy). */
export type MarketSwingTableSource = "eligible" | "developing" | "scanner" | "structure";

export type MarketSwingRankedResult = {
  rows: PersonalRankedRow[];
  source: MarketSwingTableSource;
};

export function marketSwingTableSourceDisclaimer(source: MarketSwingTableSource): string | null {
  switch (source) {
    case "eligible":
      return null;
    case "developing":
      return "Developing setups — geometry gates not yet cleared. Review Why before acting.";
    case "scanner":
      return "From platform scan — confirm structure in deep dive before sizing.";
    case "structure":
      return "Near-ready structure — not yet geometry-qualified for desk.";
    default:
      return null;
  }
}

type DeskLeader = DeskDiscoveryLeader | DeskQuietLeader;

const FEED_STATE_ORDER: Record<FeedState, number> = {
  actionable: 0,
  near: 1,
  potential: 2,
  cooling: 3
};

function isSwingDeskLeader(leader: DeskLeader): boolean {
  return leader.desk !== "day";
}

function indexEligibleSwingDeskLeaders(desk: DeskTodayData | null | undefined): Map<string, DeskLeader> {
  const map = new Map<string, DeskLeader>();
  for (const leader of desk?.discovery ?? []) {
    const sym = leader.symbol.trim().toUpperCase();
    if (!sym || !isSwingDeskLeader(leader) || leader.desk_surface_eligible === false) continue;
    map.set(sym, leader);
  }
  for (const leader of desk?.quiet_leaders ?? []) {
    const sym = leader.symbol.trim().toUpperCase();
    if (!sym || !isSwingDeskLeader(leader) || leader.desk_surface_eligible === false) continue;
    if (!map.has(sym)) map.set(sym, leader);
  }
  return map;
}

function indexDevelopingSwingDeskLeaders(desk: DeskTodayData | null | undefined): Map<string, DeskLeader> {
  const map = new Map<string, DeskLeader>();
  for (const leader of desk?.developing_setups ?? []) {
    const sym = leader.symbol.trim().toUpperCase();
    if (!sym || !isSwingDeskLeader(leader)) continue;
    map.set(sym, leader);
  }
  return map;
}

/** Desk discovery + quiet leaders only (no watchlist). */
export function collectMarketSwingSymbols(desk: DeskTodayData | null | undefined): string[] {
  return Array.from(indexEligibleSwingDeskLeaders(desk).keys());
}

export function collectPersonalRankedSymbols(input: BuildPersonalRankedRowsInput): string[] {
  const leaders = indexEligibleSwingDeskLeaders(input.swingDesk);
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

function sortLeaderRows(rows: PersonalRankedRow[], leaders: Map<string, DeskLeader>): PersonalRankedRow[] {
  return [...rows].sort((a, b) => {
    const leaderA = leaders.get(a.symbol);
    const leaderB = leaders.get(b.symbol);
    const byState =
      FEED_STATE_ORDER[(leaderA ? presentDeskLeaderState(leaderA) : a.feedState) as FeedState] -
      FEED_STATE_ORDER[(leaderB ? presentDeskLeaderState(leaderB) : b.feedState) as FeedState];
    if (byState !== 0) return byState;
    if (leaderA && leaderB && rankScore(leaderB) !== rankScore(leaderA)) {
      return rankScore(leaderB) - rankScore(leaderA);
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

function rowsFromDeskLeaders(leaders: Map<string, DeskLeader>): PersonalRankedRow[] {
  return sortLeaderRows(Array.from(leaders.values()).map(buildMarketRow), leaders);
}

function biasFromSetupDirection(direction: string | null | undefined): FeedBias {
  const d = (direction ?? "").trim().toLowerCase();
  if (d.includes("long") || d.includes("bull")) return "bull";
  if (d.includes("short") || d.includes("bear")) return "bear";
  return "neutral";
}

function feedStateFromSetup(setup: IntradaySetupPayload): FeedState {
  if (setup.qualification_tier === "near") return "near";
  const aligned = setup.alignment?.aligned ?? null;
  const total = setup.alignment?.total ?? null;
  if (aligned != null && total != null && total > 0) {
    const ratio = aligned / total;
    if (ratio >= 0.8) return "actionable";
    if (ratio >= 0.55) return "near";
    return "potential";
  }
  const score = setup.score;
  if (typeof score === "number" && Number.isFinite(score)) {
    if (score >= 75) return "actionable";
    if (score >= 55) return "near";
  }
  return "potential";
}

function rowFromSwingSetup(setup: IntradaySetupPayload): PersonalRankedRow {
  const symbol = setup.symbol.trim().toUpperCase();
  const feedState = feedStateFromSetup(setup);
  const aligned = setup.alignment?.aligned;
  const total = setup.alignment?.total;
  const readiness =
    setup.alignment?.label?.trim() ||
    (aligned != null && total != null ? `${aligned}/${total} aligned` : "Scanner qualifying");
  const directionLabel =
    biasFromSetupDirection(setup.direction) === "bull"
      ? "Long"
      : biasFromSetupDirection(setup.direction) === "bear"
        ? "Short"
        : "Neutral";
  return {
    symbol,
    readiness,
    direction: directionLabel,
    riskReward: null,
    state: FEED_STATE_LABEL[feedState],
    why: setup.alignment?.label?.trim() || "Qualifying in platform scan",
    feedState,
    bias: biasFromSetupDirection(setup.direction)
  };
}

function rowFromNearQual(row: ScannerNearQualificationRow): PersonalRankedRow {
  const symbol = row.symbol.trim().toUpperCase();
  const aligned = row.alignment?.aligned ?? 0;
  const total = row.alignment?.total ?? 6;
  const away =
    typeof row.layers_away === "number" && Number.isFinite(row.layers_away)
      ? row.layers_away
      : Math.max(0, 5 - aligned);
  return {
    symbol,
    readiness: row.alignment?.label?.trim() || `${aligned}/${total} aligned`,
    direction:
      biasFromSetupDirection(row.direction) === "bull"
        ? "Long"
        : biasFromSetupDirection(row.direction) === "bear"
          ? "Short"
          : "Neutral",
    riskReward: null,
    state: away <= 1 ? "Near ready" : FEED_STATE_LABEL.near,
    why:
      away <= 1
        ? "Close to desk gates — structure before velocity"
        : "Structure building — not a session mover",
    feedState: "near",
    bias: biasFromSetupDirection(row.direction)
  };
}

function rowFromBuildingStructure(row: BuildingStructureRow): PersonalRankedRow | null {
  if (row.source === "quiet_leader" && row.quietLeader) {
    return buildMarketRow(row.quietLeader);
  }
  if (row.source === "near_qualification" && row.nearQual) {
    return rowFromNearQual(row.nearQual);
  }
  return null;
}

function rowsFromSwingSetups(setups: readonly IntradaySetupPayload[]): PersonalRankedRow[] {
  const seen = new Set<string>();
  const out: PersonalRankedRow[] = [];
  for (const setup of setups) {
    if (setup.scanner_mode !== "swing_daily") continue;
    if (setup.desk_surface_eligible === false) continue;
    const sym = setup.symbol.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(rowFromSwingSetup(setup));
  }
  out.sort((a, b) => {
    const byState = FEED_STATE_ORDER[a.feedState] - FEED_STATE_ORDER[b.feedState];
    if (byState !== 0) return byState;
    return a.symbol.localeCompare(b.symbol);
  });
  return out;
}

function rowsFromBuildingStructure(input: BuildMarketSwingRankedRowsInput): PersonalRankedRow[] {
  const structureRows = resolveBuildingStructureRows({
    deskData: input.swingDesk,
    nearQualification: [...(input.nearQualification ?? [])]
  });
  const out: PersonalRankedRow[] = [];
  const seen = new Set<string>();
  for (const row of structureRows) {
    if (row.source === "low_velocity" || row.source === "moderate_velocity") continue;
    const built = rowFromBuildingStructure(row);
    if (!built || seen.has(built.symbol)) continue;
    seen.add(built.symbol);
    out.push(built);
  }
  return out;
}

function normalizeMarketSwingInput(
  input: DeskTodayData | null | undefined | BuildMarketSwingRankedRowsInput
): BuildMarketSwingRankedRowsInput {
  return input != null && typeof input === "object" && "swingDesk" in input
    ? input
    : { swingDesk: input as DeskTodayData | null | undefined };
}

/** Rank swing desk rows with source tier for honest fallback UX. */
export function buildMarketSwingRankedRowsResult(
  input: DeskTodayData | null | undefined | BuildMarketSwingRankedRowsInput
): MarketSwingRankedResult {
  const normalized = normalizeMarketSwingInput(input);

  const eligible = rowsFromDeskLeaders(indexEligibleSwingDeskLeaders(normalized.swingDesk));
  if (eligible.length > 0) return { rows: eligible, source: "eligible" };

  const developing = rowsFromDeskLeaders(indexDevelopingSwingDeskLeaders(normalized.swingDesk));
  if (developing.length > 0) return { rows: developing, source: "developing" };

  const fromScanner = rowsFromSwingSetups(normalized.swingSetups ?? []);
  if (fromScanner.length > 0) return { rows: fromScanner, source: "scanner" };

  return { rows: rowsFromBuildingStructure(normalized), source: "structure" };
}

/** Rank swing desk discovery + quiet leaders for the market-sourced table. */
export function buildMarketSwingRankedRows(
  input: DeskTodayData | null | undefined | BuildMarketSwingRankedRowsInput
): PersonalRankedRow[] {
  return buildMarketSwingRankedRowsResult(input).rows;
}

/** Rank watchlist + desk symbols into table rows (attention tier order). */
export function buildPersonalRankedRows(input: BuildPersonalRankedRowsInput): PersonalRankedRow[] {
  const symbols = collectPersonalRankedSymbols(input);
  if (symbols.length === 0) return [];

  const leaders = indexEligibleSwingDeskLeaders(input.swingDesk);
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
