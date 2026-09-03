/**
 * Market Brief navigation helpers — group tracked desk cards by sector ETF and
 * surface trading-relevant rows when a sector chip is opened.
 */
import type { FeedCard, FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import { SYMBOL_TO_SECTOR_ETF } from "@/lib/scanner/terminal/symbol-sector-etf-map";

const STATE_RANK: Record<FeedState, number> = {
  actionable: 0,
  near: 1,
  potential: 2,
  cooling: 3
};

export interface SectorDeskRow {
  symbol: string;
  company: string | null;
  lane: FeedLane;
  changePct: number | null;
  state: FeedState;
  verdict: string;
  bias: FeedCard["bias"];
}

export interface BriefSectorMomentumInput {
  label: string;
  pct1d?: number | null;
  pct5d?: number | null;
}

/** Prefer swing card, then day, when the same symbol appears in both lanes. */
export function preferredLaneForSymbol(cards: readonly FeedCard[], symbol: string): FeedLane {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "swing";
  const swing = cards.find((c) => c.symbol === sym && c.lane === "swing");
  if (swing) return "swing";
  const day = cards.find((c) => c.symbol === sym && c.lane === "day");
  if (day) return "day";
  return "swing";
}

export function sectorEtfForSymbol(symbol: string): string | null {
  const etf = SYMBOL_TO_SECTOR_ETF[symbol.trim().toUpperCase()];
  return etf ?? null;
}

export function buildSectorDeskRows(cards: readonly FeedCard[], sectorEtf: string): SectorDeskRow[] {
  const etf = sectorEtf.trim().toUpperCase();
  if (!etf) return [];

  const bestBySymbol = new Map<string, FeedCard>();
  for (const card of cards) {
    const mapped = sectorEtfForSymbol(card.symbol);
    if (mapped !== etf) continue;
    const existing = bestBySymbol.get(card.symbol);
    if (!existing) {
      bestBySymbol.set(card.symbol, card);
      continue;
    }
    const existingRank = STATE_RANK[existing.state];
    const nextRank = STATE_RANK[card.state];
    if (nextRank < existingRank) {
      bestBySymbol.set(card.symbol, card);
      continue;
    }
    if (nextRank === existingRank && card.rankScore > existing.rankScore) {
      bestBySymbol.set(card.symbol, card);
    }
  }

  return [...bestBySymbol.values()]
    .map((card) => ({
      symbol: card.symbol,
      company: card.company,
      lane: card.lane,
      changePct: card.changePct,
      state: card.state,
      verdict: card.verdict,
      bias: card.bias
    }))
    .sort((a, b) => {
      const stateDiff = STATE_RANK[a.state] - STATE_RANK[b.state];
      if (stateDiff !== 0) return stateDiff;
      const aMove = Math.abs(a.changePct ?? 0);
      const bMove = Math.abs(b.changePct ?? 0);
      return bMove - aMove;
    });
}

export function sectorMomentumTradingNote(sector: BriefSectorMomentumInput): string {
  const pct5d = sector.pct5d;
  const pct1d = sector.pct1d;
  if (pct5d != null && Number.isFinite(pct5d)) {
    if (pct5d >= 1.5) {
      return `${sector.label} is leading rotation (+${pct5d.toFixed(1)}% over 5d) — favor long setups aligned with sector flow.`;
    }
    if (pct5d >= 0.4) {
      return `${sector.label} has positive sector tailwind (+${pct5d.toFixed(1)}% over 5d) — stock selection matters; check desk names below.`;
    }
    if (pct5d <= -1.5) {
      return `${sector.label} is lagging (${pct5d.toFixed(1)}% over 5d) — be selective; mean-reversion only with clear structure.`;
    }
    if (pct5d <= -0.4) {
      return `${sector.label} is mixed (${pct5d.toFixed(1)}% over 5d) — prioritize individual setup quality over sector beta.`;
    }
  }
  if (pct1d != null && Number.isFinite(pct1d)) {
    if (pct1d >= 0.8) {
      return `${sector.label} led today (+${pct1d.toFixed(1)}%) — momentum names on your desk may extend if breadth holds.`;
    }
    if (pct1d <= -0.8) {
      return `${sector.label} lagged today (${pct1d.toFixed(1)}%) — avoid chasing weak-sector breakouts without confirmation.`;
    }
  }
  return `${sector.label} is flat — focus on stock-specific setup quality from the names below.`;
}

export function feedStateLabel(state: FeedState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}
