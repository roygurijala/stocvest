import { describe, expect, test } from "vitest";

import {
  adviceActionLabel,
  followThroughForReview,
  followThroughLabel,
  outcomeLabel,
  parsePortfolioLedger
} from "@/lib/portfolio/advice-ledger-present";
import type { PortfolioLedgerEvent } from "@/lib/portfolio/types";

function review(partial: Partial<PortfolioLedgerEvent>): PortfolioLedgerEvent {
  return {
    eventId: "r1",
    kind: "review",
    symbol: "WMT",
    occurredAt: "2026-08-01",
    quantity: null,
    pricePerShare: null,
    costBasisPerShare: null,
    realizedPl: null,
    realizedPlPct: null,
    remainingQuantity: null,
    cashCredited: null,
    adviceAction: "hold",
    adviceGeneratedAt: "2026-08-01T12:00:00Z",
    adviceVerdict: "bullish",
    adviceSuggestedAddAmount: null,
    adviceSuggestedReduceAmount: null,
    adviceSizingReason: null,
    adviceSleeve: "standard",
    priceAtAdvice: 100,
    weightPct: 8,
    adviceAttributionStatus: "stamped",
    priceAfter30d: null,
    priceAfter90d: null,
    outcome30d: null,
    outcome90d: null,
    ...partial
  };
}

function sale(partial: Partial<PortfolioLedgerEvent> = {}): PortfolioLedgerEvent {
  return review({
    eventId: "s1",
    kind: "sale",
    occurredAt: "2026-08-10",
    quantity: 4,
    pricePerShare: 95,
    costBasisPerShare: 80,
    realizedPl: 60,
    adviceAction: "sell",
    ...partial
  });
}

function buy(partial: Partial<PortfolioLedgerEvent> = {}): PortfolioLedgerEvent {
  return review({
    eventId: "b1",
    kind: "buy",
    occurredAt: "2026-08-10",
    quantity: 2,
    pricePerShare: 110,
    adviceAction: "buy_more",
    ...partial
  });
}

describe("parsePortfolioLedger", () => {
  test("returns null for a missing events array", () => {
    expect(parsePortfolioLedger(null)).toBeNull();
    expect(parsePortfolioLedger({})).toBeNull();
  });

  test("parses sale and review rows plus summary defaults", () => {
    const parsed = parsePortfolioLedger({
      count: 2,
      events: [
        {
          eventId: "e1",
          kind: "sale",
          symbol: "wmt",
          occurredAt: "2026-09-14",
          quantity: 4,
          salePrice: 200,
          pricePerShare: 200,
          realizedPl: 72,
          adviceAction: "sell",
          outcome30d: "favorable"
        },
        { kind: "review", symbol: "WMT", occurredAt: "2026-08-01", adviceAction: "hold" },
        { kind: "noise", symbol: "X" }
      ],
      summary: {
        salesCount: 1,
        realizedPl: 72,
        outcome30d: { favorable: 1, pending: 0 },
        followThrough: { followed: 1, ignored: 0, diverged: 0 }
      }
    });
    expect(parsed?.count).toBe(2);
    expect(parsed?.events).toHaveLength(2);
    expect(parsed?.events[0].symbol).toBe("WMT");
    expect(parsed?.events[0].kind).toBe("sale");
    expect(parsed?.events[0].realizedPl).toBe(72);
    expect(parsed?.summary.salesCount).toBe(1);
    expect(parsed?.summary.outcome30d.favorable).toBe(1);
    expect(parsed?.summary.followThrough.followed).toBe(1);
  });
});

describe("followThroughForReview", () => {
  test("sell/trim later sale is followed; no sale is ignored", () => {
    const r = review({ adviceAction: "sell" });
    expect(followThroughForReview(r, [r, sale()])).toBe("followed");
    expect(followThroughForReview(r, [r])).toBe("ignored");
    const trim = review({ eventId: "r2", adviceAction: "trim" });
    expect(followThroughForReview(trim, [trim, sale({ eventId: "s2" })])).toBe("followed");
  });

  test("buy_more later buy is followed", () => {
    const r = review({ adviceAction: "buy_more" });
    expect(followThroughForReview(r, [r, buy()])).toBe("followed");
    expect(followThroughForReview(r, [r])).toBe("ignored");
  });

  test("hold later sale is diverged; staying put is followed", () => {
    const r = review({ adviceAction: "hold" });
    expect(followThroughForReview(r, [r, sale()])).toBe("diverged");
    expect(followThroughForReview(r, [r])).toBe("followed");
  });

  test("ignores earlier trades and other symbols", () => {
    const r = review({ occurredAt: "2026-08-15" });
    const earlier = sale({ eventId: "old", occurredAt: "2026-08-01" });
    const other = sale({ eventId: "x", symbol: "AAPL", occurredAt: "2026-08-20" });
    expect(followThroughForReview(r, [earlier, r, other])).toBe("followed");
  });

  test("next-day sell restamp still followed after the prior-day sale", () => {
    const first = review({
      eventId: "2026-09-14#rev",
      occurredAt: "2026-09-14",
      adviceAction: "sell",
      symbol: "ARKQ"
    });
    const sold = sale({
      eventId: "2026-09-14#sale",
      occurredAt: "2026-09-14",
      symbol: "ARKQ"
    });
    const restamp = review({
      eventId: "2026-09-15#rev",
      occurredAt: "2026-09-15",
      adviceAction: "sell",
      symbol: "ARKQ"
    });
    expect(followThroughForReview(first, [first, sold, restamp])).toBe("followed");
    expect(followThroughForReview(restamp, [first, sold, restamp])).toBe("followed");
  });

  test("hold that already suggested a reduce is followed by a sale", () => {
    const r = review({
      adviceAction: "hold",
      adviceSuggestedReduceAmount: 40,
      symbol: "XOVR"
    });
    expect(followThroughForReview(r, [r, sale({ symbol: "XOVR" })])).toBe("followed");
  });
});

describe("labels", () => {
  test("maps outcomes, actions, and follow-through", () => {
    expect(outcomeLabel("favorable")).toBe("Favorable");
    expect(outcomeLabel("unfavorable")).toBe("Unfavorable");
    expect(outcomeLabel(null)).toBe("Pending");
    expect(adviceActionLabel("buy_more")).toBe("Buy more");
    expect(adviceActionLabel("trim")).toBe("Trim");
    expect(followThroughLabel("followed")).toBe("Followed");
    expect(followThroughLabel("diverged")).toBe("Diverged");
    expect(followThroughLabel("n/a")).toBe("—");
  });
});
