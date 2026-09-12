import { describe, expect, test } from "vitest";

import { parsePositionOwner } from "@/lib/dashboard/trading-room/position-fundamentals-present";

describe("parsePositionOwner", () => {
  test("returns null when the caller does not hold the symbol", () => {
    expect(parsePositionOwner({})).toBeNull();
    expect(parsePositionOwner({ position_owner: null })).toBeNull();
    expect(parsePositionOwner(undefined)).toBeNull();
  });

  test("parses a held-symbol owner context (snake_case → camelCase)", () => {
    const owner = parsePositionOwner({
      position_owner: {
        symbol: "aapl",
        quantity: 10,
        average_cost: 100,
        current_price: 120,
        market_value: 1200,
        unrealized_pl: 200,
        unrealized_pl_pct: 20,
        action: "buy_more",
        action_label: "Buy more",
        holder_stance: "constructive",
        tax_lot_hint: "All 1 lot(s) are long-term.",
        long_term_lots: 1,
        short_term_lots: 0,
        lot_count: 1,
        earliest_purchase_date: "2020-01-01",
        disclaimer: "Informational."
      }
    });
    expect(owner).not.toBeNull();
    expect(owner?.symbol).toBe("AAPL");
    expect(owner?.action).toBe("buy_more");
    expect(owner?.unrealizedPl).toBe(200);
    expect(owner?.longTermLots).toBe(1);
    expect(owner?.earliestPurchaseDate).toBe("2020-01-01");
  });

  test("falls back to 'review' for an unknown action", () => {
    const owner = parsePositionOwner({
      position_owner: { symbol: "XOM", action: "yolo" }
    });
    expect(owner?.action).toBe("review");
  });
});
