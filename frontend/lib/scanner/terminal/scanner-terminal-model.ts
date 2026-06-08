/**
 * Scanner Terminal — pure section model for the redesigned funnel layout.
 * Reuses Trading Room feed cards + existing scanner/desk contracts.
 */

import type { DeskQuietLeader, DeskTodayData } from "@/lib/api/desk-today";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import {
  buildFeedCards,
  type FeedBias,
  type FeedCard,
  type FeedLane,
  type FeedState
} from "@/lib/dashboard/trading-room/feed-model";
import { isSwingSetupRow } from "@/lib/scanner-setups-response";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";

export type ScannerTerminalModeFilter = "all" | "day" | "swing";
export type ScannerTerminalStateFilter = "all" | "actionable" | "developing";

export type ScannerTerminalFilters = {
  mode: ScannerTerminalModeFilter;
  state: ScannerTerminalStateFilter;
  watchlistOnly: boolean;
  query: string;
};

export const DEFAULT_SCANNER_TERMINAL_FILTERS: ScannerTerminalFilters = {
  mode: "all",
  state: "all",
  watchlistOnly: false,
  query: ""
};

export type ScannerTerminalGapRow = {
  symbol: string;
  company: string | null;
  gapPct: number;
  statusLabel: string;
  note: string | null;
  lane: FeedLane | "either";
};

export type ScannerTerminalSignalRow = {
  id: string;
  symbol: string;
  company: string | null;
  lane: FeedLane;
  state: FeedState;
  bias: FeedBias;
  alignment: { aligned: number; total: number } | null;
  riskReward: number | null;
  verdict: string;
  price: number | null;
  changePct: number | null;
  blockerNote: string | null;
};

export type ScannerTerminalRadarGroup = {
  id: string;
  title: string;
  symbols: string[];
  note: string | null;
};

export type ScannerTerminalSelection =
  | { kind: "gap"; symbol: string }
  | { kind: "signal"; id: string }
  | { kind: "radar"; groupId: string; symbol?: string }
  | null;

function normQuery(q: string): string {
  return q.trim().toUpperCase();
}

function matchesQuery(symbol: string, company: string | null, query: string): boolean {
  if (!query) return true;
  const sym = symbol.toUpperCase();
  if (sym.includes(query)) return true;
  const name = (company ?? "").toUpperCase();
  return name.includes(query);
}

function laneMatches(mode: ScannerTerminalModeFilter, lane: FeedLane): boolean {
  if (mode === "all") return true;
  return lane === mode;
}

function gapLane(item: GapIntelligenceItem): FeedLane | "either" {
  const fit = (item.mode_best_fit ?? "either").toLowerCase();
  if (fit === "day") return "day";
  if (fit === "swing") return "swing";
  return "either";
}

function gapStatusLabel(item: GapIntelligenceItem): string {
  const score = item.gap_quality_score;
  const vol = item.volume_vs_avg;
  if (score >= 70 && vol >= 1.2) return "accepted";
  if (score >= 50) return "fill watch";
  return "watching";
}

function gapNote(item: GapIntelligenceItem): string | null {
  const name = item.company_name?.trim();
  const catalyst =
    item.catalyst?.headline?.trim() || item.catalyst?.article_description?.trim();
  if (name && catalyst) return `${name} — ${catalyst}`;
  if (catalyst) return catalyst;
  if (item.no_catalyst_warning?.trim()) return item.no_catalyst_warning.trim();
  return name || null;
}

export function buildGapRows(
  items: GapIntelligenceItem[],
  filters: ScannerTerminalFilters
): ScannerTerminalGapRow[] {
  const query = normQuery(filters.query);
  return items
    .filter((item) => {
      const lane = gapLane(item);
      if (filters.mode !== "all" && lane !== "either" && lane !== filters.mode) return false;
      return matchesQuery(item.symbol, item.company_name, query);
    })
    .slice(0, 12)
    .map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      company: item.company_name?.trim() || null,
      gapPct: item.gap_pct,
      statusLabel: gapStatusLabel(item),
      note: gapNote(item),
      lane: gapLane(item)
    }));
}

function rrFromSetup(setup: IntradaySetupPayload | undefined): number | null {
  if (!setup) return null;
  const rr = (setup as { risk_reward?: number }).risk_reward;
  return typeof rr === "number" && Number.isFinite(rr) ? rr : null;
}

function setupBySymbolLane(
  setups: IntradaySetupPayload[]
): Map<string, IntradaySetupPayload> {
  const map = new Map<string, IntradaySetupPayload>();
  for (const s of setups) {
    const lane: FeedLane = isSwingSetupRow(s) ? "swing" : "day";
    map.set(`${lane}:${s.symbol.trim().toUpperCase()}`, s);
  }
  return map;
}

export function feedCardToSignalRow(
  card: FeedCard,
  setupLookup: Map<string, IntradaySetupPayload>
): ScannerTerminalSignalRow {
  const setup = setupLookup.get(card.id);
  const blocker =
    card.state === "actionable"
      ? null
      : card.verdict?.trim() || setup?.triggers?.find((t) => t.trim())?.trim() || null;
  return {
    id: card.id,
    symbol: card.symbol,
    company: card.company,
    lane: card.lane,
    state: card.state,
    bias: card.bias,
    alignment: card.alignment,
    riskReward: rrFromSetup(setup),
    verdict: card.verdict,
    price: card.price,
    changePct: card.changePct,
    blockerNote: blocker
  };
}

function developingBlocker(row: ScannerNearQualificationRow): string | null {
  if (row.layers_away != null && row.layers_away > 0) {
    return `needs ${row.layers_away} more layer${row.layers_away === 1 ? "" : "s"}`;
  }
  if (row.alignment?.label?.trim()) return row.alignment.label.trim();
  return `score ${Math.round(row.score)}`;
}

export function nearQualToDevelopingRows(
  rows: ScannerNearQualificationRow[],
  filters: ScannerTerminalFilters
): ScannerTerminalSignalRow[] {
  const query = normQuery(filters.query);
  return rows
    .filter((row) => laneMatches(filters.mode, row.desk) && matchesQuery(row.symbol, row.company_name ?? null, query))
    .map((row) => ({
      id: `${row.desk}:${row.symbol}`,
      symbol: row.symbol,
      company: row.company_name ?? null,
      lane: row.desk,
      state: "near" as const,
      bias: row.direction.toLowerCase().includes("bear") ? "bear" : row.direction.toLowerCase().includes("bull") ? "bull" : "neutral",
      alignment: row.alignment
        ? { aligned: row.alignment.aligned, total: row.alignment.total }
        : null,
      riskReward: null,
      verdict: row.alignment?.label ?? "Approaching threshold",
      price: null,
      changePct: null,
      blockerNote: developingBlocker(row)
    }));
}

export function buildRadarGroups(
  swingDesk: DeskTodayData | null | undefined,
  dayDesk: DeskTodayData | null | undefined,
  mode: ScannerTerminalModeFilter
): ScannerTerminalRadarGroup[] {
  const groups: ScannerTerminalRadarGroup[] = [];

  const movers = [
    ...(mode !== "day" ? swingDesk?.movers_radar ?? [] : []),
    ...(mode !== "swing" ? dayDesk?.movers_radar ?? [] : [])
  ];
  if (movers.length > 0) {
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const row of movers) {
      const sym = row.symbol.trim().toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      symbols.push(sym);
      if (symbols.length >= 8) break;
    }
    groups.push({
      id: "session-movers",
      title: "Session movers",
      symbols,
      note: "Largest gap % names in today's desk funnel."
    });
  }

  const quiet: DeskQuietLeader[] = [
    ...(mode !== "day" ? swingDesk?.quiet_leaders ?? [] : []),
    ...(mode !== "swing" ? dayDesk?.quiet_leaders ?? [] : [])
  ];
  if (quiet.length > 0) {
    groups.push({
      id: "building-structure",
      title: "Building structure",
      symbols: quiet.slice(0, 8).map((q) => q.symbol.trim().toUpperCase()),
      note: quiet[0]?.why_line?.trim() ?? "Quiet leaders — structure forming without a full gap flag."
    });
  }

  return groups;
}

export type BuildScannerTerminalInput = {
  filters: ScannerTerminalFilters;
  gapIntelligence: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  swingDesk: DeskTodayData | null | undefined;
  dayDesk: DeskTodayData | null | undefined;
  nearQualification: ScannerNearQualificationRow[];
  dayTradingSurfaces: boolean;
  watchlistSymbols: Set<string>;
};

export type ScannerTerminalSections = {
  gaps: ScannerTerminalGapRow[];
  actionable: ScannerTerminalSignalRow[];
  developing: ScannerTerminalSignalRow[];
  radar: ScannerTerminalRadarGroup[];
  actionableCount: number;
};

export function buildScannerTerminalSections(input: BuildScannerTerminalInput): ScannerTerminalSections {
  const { filters, watchlistSymbols } = input;
  const cards = buildFeedCards({
    mode: "swing",
    swingDesk: input.swingDesk,
    dayDesk: input.dayDesk,
    swingSetups: input.setups.filter((s) => isSwingSetupRow(s)),
    daySetups: input.setups.filter((s) => !isSwingSetupRow(s)),
    snapshotsBySymbol: new Map(),
    dayTradingSurfaces: input.dayTradingSurfaces
  });

  const setupLookup = setupBySymbolLane(input.setups);
  const query = normQuery(filters.query);

  const passesWatchlist = (symbol: string) =>
    !filters.watchlistOnly || watchlistSymbols.has(symbol.trim().toUpperCase());

  const signalRows = cards
    .map((c) => feedCardToSignalRow(c, setupLookup))
    .filter(
      (row) =>
        laneMatches(filters.mode, row.lane) &&
        passesWatchlist(row.symbol) &&
        matchesQuery(row.symbol, row.company, query)
    );

  const actionable = signalRows.filter((r) => r.state === "actionable");
  const developingFromFeed = signalRows.filter((r) => r.state === "near" || r.state === "potential");
  const developingFromNear = nearQualToDevelopingRows(input.nearQualification, filters).filter((r) =>
    passesWatchlist(r.symbol)
  );

  const developingById = new Map<string, ScannerTerminalSignalRow>();
  for (const row of [...developingFromFeed, ...developingFromNear]) {
    const existing = developingById.get(row.id);
    if (!existing || row.state === "near") developingById.set(row.id, row);
  }
  const developing = [...developingById.values()].slice(0, 16);

  const gaps = buildGapRows(input.gapIntelligence, filters).filter((g) => passesWatchlist(g.symbol));

  let actionableOut = actionable;
  let developingOut = developing;
  if (filters.state === "actionable") developingOut = [];
  if (filters.state === "developing") actionableOut = [];

  return {
    gaps,
    actionable: actionableOut.slice(0, 12),
    developing: developingOut.slice(0, 16),
    radar: buildRadarGroups(input.swingDesk, input.dayDesk, filters.mode),
    actionableCount: actionable.length
  };
}
