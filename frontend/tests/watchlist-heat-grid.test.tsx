import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatchlistHeatGrid } from "@/components/dashboard/trading-room/watchlist-heat-grid";
import { DATA_INTERACTION_LEVEL } from "@/lib/dashboard/click-hierarchy";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

const colors = {
  surface: "#111",
  surfaceMuted: "#1a1a1a",
  border: "#333",
  text: "#eee",
  textMuted: "#999",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b",
  accent: "#3b82f6"
};

function card(partial: Partial<FeedCard> & Pick<FeedCard, "symbol" | "state">): FeedCard {
  return {
    id: `swing:${partial.symbol}`,
    company: null,
    lane: "swing",
    bias: "neutral",
    verdict: "Test",
    phase: null,
    price: 100,
    changePct: partial.changePct ?? 1.2,
    alignment: null,
    rankScore: 0,
    source: "desk",
    setupTier: "setup",
    lastEvaluatedAt: null,
    ...partial
  };
}

describe("WatchlistHeatGrid (ADR-003 UX-D7)", () => {
  it("renders heat cells with deep interaction and actionable badge", () => {
    const onSelect = vi.fn();
    render(
      <WatchlistHeatGrid
        cards={[
          card({ symbol: "NVDA", state: "actionable", changePct: 2.1 }),
          card({ symbol: "AAPL", state: "potential", changePct: -0.5 })
        ]}
        selectedId={null}
        colors={colors}
        onSelectCard={onSelect}
      />
    );

    const cell = screen.getByTestId("trading-room-watchlist-heat-NVDA");
    expect(cell).toHaveAttribute(DATA_INTERACTION_LEVEL, "deep");
    expect(cell).toHaveTextContent("Actionable");
    expect(cell).toHaveTextContent("vs grp");
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders an investment-quality dot only for symbols with a scan row (POS-D14)", () => {
    render(
      <WatchlistHeatGrid
        cards={[card({ symbol: "NVDA", state: "actionable" }), card({ symbol: "AAPL", state: "potential" })]}
        selectedId={null}
        colors={colors}
        onSelectCard={vi.fn()}
        qualityBySymbol={
          new Map([["NVDA", { tier: "gem" as const, short: "Gem", tooltip: "Gem candidate — weakest pillar: F4 · Valuation" }]])
        }
      />
    );

    const dots = screen.getAllByTestId("watchlist-heat-quality-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("data-tier", "gem");
    expect(dots[0]).toHaveAttribute("title", "Gem candidate — weakest pillar: F4 · Valuation");
  });
});
