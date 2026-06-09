/**
 * Scanner Terminal — pure section model for the redesigned funnel layout.
 * Reuses Trading Room feed cards + existing scanner/desk contracts.
 */

import type { IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";
import type { DeskQuietLeader, DeskTodayData } from "@/lib/api/desk-today";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import { buildIpoEcosystemRadarGroups } from "@/lib/scanner/terminal/scanner-terminal-ipo-themes";
import {
  buildFeedCards,
  type FeedBias,
  type FeedCard,
  type FeedLane,
  type FeedState
} from "@/lib/dashboard/trading-room/feed-model";
import type { SectorRotationChip } from "@/lib/market-context/types";
import { isSwingSetupRow } from "@/lib/scanner-setups-response";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import {
  buildSectorThemeGroups,
  collectFunnelSymbols
} from "@/lib/scanner/terminal/scanner-terminal-sector-themes";

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
  gapDollars: number;
  prevClose: number;
  currentPrice: number;
  volumeVsAvg: number;
  gapQualityScore: number;
  statusLabel: string;
  note: string | null;
  catalystHeadline: string | null;
  catalystDescription: string | null;
  hasCatalyst: boolean;
  noCatalystWarning: string | null;
  marketContextWarning: string | null;
  fillWatchReason: string;
  monitorNote: string;
  lane: FeedLane | "either";
  isIpoWatch: boolean;
  unscored: boolean;
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
  triggers: string[];
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
  | { kind: "lookup"; symbol: string; lane: FeedLane }
  | null;

/** Ticker-shaped search (1–6 alnum) for why-missing lookup. */
export function isTickerSearchQuery(query: string): string | null {
  const q = query.trim().toUpperCase();
  if (!q || q.length > 6) return null;
  if (!/^[A-Z][A-Z0-9.-]{0,5}$/.test(q)) return null;
  return q;
}

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
  const catalyst = item.catalyst?.headline?.trim() || item.catalyst?.article_description?.trim();
  if (catalyst) return catalyst;
  if (item.market_context_warning?.trim()) return item.market_context_warning.trim();
  if (item.no_catalyst_warning?.trim()) return item.no_catalyst_warning.trim();
  return item.company_name?.trim() || null;
}

export function gapFillWatchReason(item: GapIntelligenceItem): string {
  const status = gapStatusLabel(item);
  const volLabel =
    item.volume_vs_avg >= 1.5 ? "heavy" : item.volume_vs_avg >= 1 ? "above average" : "light";
  if (status === "accepted") {
    return `${volLabel.charAt(0).toUpperCase()}${volLabel.slice(1)} volume — gap cleared our open filter.`;
  }
  if (status === "fill watch") {
    return `Gap is material but ${volLabel} volume keeps it on fill watch until the open proves direction.`;
  }
  return "Monitoring only until volume and catalyst improve.";
}

export function gapMonitorNote(item: GapIntelligenceItem): string {
  const prev = item.prev_close;
  const status = gapStatusLabel(item);
  if (status === "fill watch") {
    return item.gap_pct >= 0
      ? `Watch for gap fill toward $${prev.toFixed(2)} (prev close). Hold above the open = continuation; fade back through VWAP = caution.`
      : `Watch for bounce or further flush — reclaim of $${prev.toFixed(2)} would negate the gap down.`;
  }
  if (item.gap_pct >= 0) {
    return `Monitor pre-market high and first 15m volume — extension needs ${item.volume_vs_avg >= 1.2 ? "sustained" : "stronger"} participation.`;
  }
  return `Monitor for capitulation vs. dead-cat bounce — prev close $${prev.toFixed(2)} is the reclaim line.`;
}

function gapRowFromItem(item: GapIntelligenceItem, opts?: { ipoWatch?: boolean }): ScannerTerminalGapRow {
  const ipoWatch = opts?.ipoWatch === true || item.ipo_watch === true;
  const note = ipoWatch
    ? item.ipo_watch_note?.trim() || gapNote(item) || "Not evaluated by signal engine"
    : gapNote(item);
  return {
    symbol: item.symbol.trim().toUpperCase(),
    company: item.company_name?.trim() || null,
    gapPct: item.gap_pct,
    gapDollars: item.gap_dollars,
    prevClose: item.prev_close,
    currentPrice: item.current_price,
    volumeVsAvg: item.volume_vs_avg,
    gapQualityScore: item.gap_quality_score,
    statusLabel: ipoWatch ? "unscored" : gapStatusLabel(item),
    note,
    catalystHeadline: item.catalyst?.headline?.trim() || null,
    catalystDescription: item.catalyst?.article_description?.trim() || null,
    hasCatalyst: item.has_catalyst,
    noCatalystWarning: item.no_catalyst_warning?.trim() || null,
    marketContextWarning: item.market_context_warning?.trim() || null,
    fillWatchReason: ipoWatch
      ? "New listing — gap shown for monitoring only; composite and ranked movers exclude this symbol."
      : gapFillWatchReason(item),
    monitorNote: ipoWatch
      ? "Add to watchlist to track; open symbol for context. Signal engine requires 90 sessions of listing history."
      : gapMonitorNote(item),
    lane: gapLane(item),
    isIpoWatch: ipoWatch,
    unscored: ipoWatch || item.unscored === true
  };
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
    .map((item) => gapRowFromItem(item));
}

export function buildIpoWatchRows(
  items: GapIntelligenceItem[],
  filters: ScannerTerminalFilters
): ScannerTerminalGapRow[] {
  const query = normQuery(filters.query);
  return items
    .filter((item) => matchesQuery(item.symbol, item.company_name, query))
    .slice(0, 6)
    .map((item) => gapRowFromItem(item, { ipoWatch: true }));
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
    blockerNote: blocker,
    triggers: setup?.triggers?.filter((t) => t.trim()) ?? []
  };
}

function developingBlocker(row: ScannerNearQualificationRow): string | null {
  if (row.layers_away != null && row.layers_away > 0) {
    return `needs ${row.layers_away} more layer${row.layers_away === 1 ? "" : "s"}`;
  }
  if (row.alignment?.label?.trim()) return row.alignment.label.trim();
  return null;
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
      blockerNote: developingBlocker(row),
      triggers: []
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
  gapIpoWatch?: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  swingDesk: DeskTodayData | null | undefined;
  dayDesk: DeskTodayData | null | undefined;
  nearQualification: ScannerNearQualificationRow[];
  dayTradingSurfaces: boolean;
  watchlistSymbols: Set<string>;
  sectorRotation?: SectorRotationChip[];
  ipoEcosystems?: IpoEcosystemPayload[];
};

export type ScannerTerminalSections = {
  gaps: ScannerTerminalGapRow[];
  ipoWatch: ScannerTerminalGapRow[];
  actionable: ScannerTerminalSignalRow[];
  developing: ScannerTerminalSignalRow[];
  developingClosest: ScannerTerminalSignalRow[];
  developingAlso: ScannerTerminalSignalRow[];
  radar: ScannerTerminalRadarGroup[];
  actionableCount: number;
};

export function selectionTitle(
  selection: ScannerTerminalSelection,
  sections: Pick<ScannerTerminalSections, "gaps" | "actionable" | "developing" | "radar">
): string | null {
  if (!selection) return null;
  if (selection.kind === "gap") return selection.symbol;
  if (selection.kind === "lookup") return selection.symbol;
  if (selection.kind === "radar") {
    const group = sections.radar.find((g) => g.id === selection.groupId);
    return group?.title ?? "On radar";
  }
  const row =
    sections.actionable.find((r) => r.id === selection.id) ??
    sections.developing.find((r) => r.id === selection.id);
  return row?.symbol ?? null;
}

export function splitDevelopingRows(rows: ScannerTerminalSignalRow[]): {
  closest: ScannerTerminalSignalRow[];
  also: ScannerTerminalSignalRow[];
} {
  const closest = rows.filter((r) => r.state === "near");
  const also = rows.filter((r) => r.state !== "near");
  return { closest, also };
}

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
  const ipoWatch = buildIpoWatchRows(input.gapIpoWatch ?? [], filters).filter((g) =>
    passesWatchlist(g.symbol)
  );

  let actionableOut = actionable;
  let developingOut = developing;
  if (filters.state === "actionable") developingOut = [];
  if (filters.state === "developing") actionableOut = [];

  const developingCapped = developingOut.slice(0, 16);
  const { closest, also } = splitDevelopingRows(developingCapped);

  const funnelSymbols = collectFunnelSymbols({
    gapIntelligence: input.gapIntelligence,
    setups: input.setups,
    swingDesk: input.swingDesk,
    dayDesk: input.dayDesk,
    watchlistSymbols: input.watchlistSymbols
  });
  const sectorThemes = buildSectorThemeGroups(input.sectorRotation ?? [], funnelSymbols);
  const ipoThemes = buildIpoEcosystemRadarGroups(input.ipoEcosystems);
  const radarBase = buildRadarGroups(input.swingDesk, input.dayDesk, filters.mode);
  const radar = [...ipoThemes, ...sectorThemes, ...radarBase].slice(0, 6);

  return {
    gaps,
    ipoWatch,
    actionable: actionableOut.slice(0, 12),
    developing: developingCapped,
    developingClosest: closest,
    developingAlso: also,
    radar,
    actionableCount: actionable.length
  };
}
