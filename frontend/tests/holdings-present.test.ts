import { describe, expect, test } from "vitest";
import {
  buildPortfolioView,
  suggestedAddAmount
} from "@/lib/portfolio/holdings-present";
import { DEFAULT_PORTFOLIO_SETTINGS, type Holding } from "@/lib/portfolio/types";

function holding(symbol: string, qty: number, avgCost: number, lots = 1): Holding {
  return {
    symbol,
    totalQuantity: qty,
    averageCost: avgCost,
    totalCost: qty * avgCost,
    lots: Array.from({ length: lots }, (_, i) => ({
      lotId: `${symbol}-${i}`,
      quantity: qty / lots,
      costBasis: avgCost,
      purchaseDate: "2024-01-15"
    }))
  };
}

describe("buildPortfolioView", () => {
  test("computes market value, unrealized P/L and weights from live prices", () => {
    const holdings = [holding("AAPL", 10, 100), holding("MSFT", 5, 200)];
    const prices = new Map([
      ["AAPL", 150],
      ["MSFT", 200]
    ]);
    const settings = { ...DEFAULT_PORTFOLIO_SETTINGS, cashBalance: 1000 };
    const view = buildPortfolioView(holdings, settings, (s) => prices.get(s) ?? null);

    // AAPL: 10*150=1500 (cost 1000 → +500 / +50%); MSFT: 5*200=1000 (cost 1000 → +0)
    const aapl = view.rows.find((r) => r.symbol === "AAPL")!;
    expect(aapl.marketValue).toBe(1500);
    expect(aapl.unrealizedPl).toBe(500);
    expect(aapl.unrealizedPlPct).toBe(50);

    expect(view.investedValue).toBe(2500);
    expect(view.investedCost).toBe(2000);
    expect(view.cashBalance).toBe(1000);
    expect(view.totalValue).toBe(3500); // invested + cash
    expect(view.unrealizedPl).toBe(500);
    expect(view.unrealizedPlPct).toBe(25); // 500/2000
    expect(view.fullyPriced).toBe(true);

    // weight uses total portfolio value incl. cash
    expect(aapl.weightPct).toBeCloseTo((1500 / 3500) * 100, 1);
  });

  test("falls back to cost when a price is missing (P/L null, not fake 0)", () => {
    const holdings = [holding("AAPL", 10, 100)];
    const view = buildPortfolioView(holdings, DEFAULT_PORTFOLIO_SETTINGS, () => null);
    const aapl = view.rows[0];
    expect(aapl.priced).toBe(false);
    expect(aapl.currentPrice).toBeNull();
    expect(aapl.marketValue).toBe(1000); // qty * avg cost fallback
    expect(aapl.unrealizedPl).toBeNull();
    expect(aapl.unrealizedPlPct).toBeNull();
    expect(view.fullyPriced).toBe(false);
  });

  test("empty portfolio is coherent", () => {
    const view = buildPortfolioView([], { ...DEFAULT_PORTFOLIO_SETTINGS, cashBalance: 500 }, () => 1);
    expect(view.holdingsCount).toBe(0);
    expect(view.totalValue).toBe(500);
    expect(view.unrealizedPl).toBe(0);
    expect(view.fullyPriced).toBe(false);
  });
});

describe("suggestedAddAmount", () => {
  test("returns null when no target set", () => {
    expect(suggestedAddAmount(1000, 10000, null, 5000)).toBeNull();
  });

  test("suggests the gap up to target, capped by cash", () => {
    // target 10% of 10000 = 1000; current 400 → gap 600; cash ample
    expect(suggestedAddAmount(400, 10000, 10, 5000)).toBe(600);
    // gap 600 but only 250 cash → capped
    expect(suggestedAddAmount(400, 10000, 10, 250)).toBe(250);
  });

  test("returns 0 when already at/over target", () => {
    expect(suggestedAddAmount(1500, 10000, 10, 5000)).toBe(0);
  });
});
