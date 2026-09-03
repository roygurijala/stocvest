import { describe, expect, it } from "vitest";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
import {
  buildSectorDeskRows,
  preferredLaneForSymbol,
  sectorEtfForSymbol,
  sectorMomentumTradingNote
} from "@/lib/dashboard/trading-room/market-brief-navigation";

function card(partial: Partial<FeedCard> & Pick<FeedCard, "symbol" | "lane">): FeedCard {
  return {
    id: `${partial.lane}:${partial.symbol}`,
    company: partial.company ?? null,
    state: partial.state ?? "potential",
    bias: partial.bias ?? "neutral",
    verdict: partial.verdict ?? "Test verdict",
    phase: null,
    price: null,
    changePct: partial.changePct ?? null,
    alignment: null,
    rankScore: partial.rankScore ?? 0,
    source: "desk",
    setupTier: "setup",
    lastEvaluatedAt: null,
    ...partial
  };
}

describe("market-brief-navigation", () => {
  it("maps symbols to sector ETFs", () => {
    expect(sectorEtfForSymbol("NVDA")).toBe("XLK");
    expect(sectorEtfForSymbol("JPM")).toBe("XLF");
    expect(sectorEtfForSymbol("UNKNOWN")).toBeNull();
  });

  it("prefers swing lane when both lanes exist", () => {
    const cards = [
      card({ symbol: "NVDA", lane: "day", state: "actionable" }),
      card({ symbol: "NVDA", lane: "swing", state: "near" })
    ];
    expect(preferredLaneForSymbol(cards, "NVDA")).toBe("swing");
  });

  it("ranks sector desk rows by readiness then move", () => {
    const cards = [
      card({ symbol: "NVDA", lane: "swing", state: "near", changePct: 2.1, rankScore: 10 }),
      card({ symbol: "AMD", lane: "swing", state: "actionable", changePct: 0.5, rankScore: 20 }),
      card({ symbol: "JPM", lane: "swing", state: "actionable", changePct: 1.2, rankScore: 5 })
    ];
    const rows = buildSectorDeskRows(cards, "XLK");
    expect(rows.map((r) => r.symbol)).toEqual(["AMD", "NVDA"]);
  });

  it("builds a trading note from sector momentum", () => {
    const note = sectorMomentumTradingNote({ label: "Financials", pct5d: 1.8, pct1d: 0.4 });
    expect(note).toContain("leading rotation");
    expect(note).toContain("Financials");
  });
});
