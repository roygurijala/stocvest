import { describe, expect, test } from "vitest";

import {
  adviceActionLabel,
  adviceTrackNowMove,
  adviceTrackSinceLine,
  adviceTrackSummaryLine,
  buildAdviceEpisodeRows,
  episodeAfterLabel,
  episodeCallLabel,
  episodeCallSizeLabel,
  episodeResultLabel,
  episodeStanceLabel,
  followThroughForReview,
  followThroughLabel,
  formatAdviceDay,
  formatEpisodeWindow,
  outcomeLabel,
  parsePortfolioLedger,
  selectAdviceTrackRows
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
    lastConfirmedAt: null,
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

describe("advice episodes", () => {
  test("collapses next-day restamps of the same call", () => {
    const first = review({
      eventId: "2026-09-14#nvda",
      symbol: "NVDA",
      occurredAt: "2026-09-14",
      adviceAction: "hold",
      priceAtAdvice: 212
    });
    const restamp = review({
      eventId: "2026-09-15#nvda",
      symbol: "NVDA",
      occurredAt: "2026-09-15",
      adviceAction: "hold",
      priceAtAdvice: 200
    });
    const rows = buildAdviceEpisodeRows([first, restamp]);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toBe("2026-09-14");
    expect(rows[0].lastConfirmedAt).toBe("2026-09-15");
    expect(rows[0].priceAtAdvice).toBe(212);
    expect(formatAdviceDay(rows[0].startedAt)).toBe("Sep 14");
    expect(formatEpisodeWindow(rows[0].startedAt, rows[0].lastConfirmedAt)).toBe("Sep 14–15");
  });

  test("collapses the same call even when another symbol sits between restamps", () => {
    const nvdaFirst = review({
      eventId: "n1",
      symbol: "NVDA",
      occurredAt: "2026-09-14",
      adviceAction: "hold",
      priceAtAdvice: 212
    });
    const msft = review({
      eventId: "m1",
      symbol: "MSFT",
      occurredAt: "2026-09-14",
      adviceAction: "hold",
      priceAtAdvice: 430
    });
    const nvdaLater = review({
      eventId: "n2",
      symbol: "NVDA",
      occurredAt: "2026-09-15",
      adviceAction: "hold",
      priceAtAdvice: 200
    });
    const rows = buildAdviceEpisodeRows([nvdaFirst, msft, nvdaLater]);
    expect(rows).toHaveLength(2);
    const nvda = rows.find((r) => r.symbol === "NVDA");
    expect(nvda?.startedAt).toBe("2026-09-14");
    expect(nvda?.lastConfirmedAt).toBe("2026-09-15");
    expect(nvda?.priceAtAdvice).toBe(212);
  });

  test("opens a new row when add/reduce crosses zero", () => {
    const hold = review({
      eventId: "a",
      symbol: "MSFT",
      occurredAt: "2026-09-14",
      adviceAction: "hold",
      adviceSuggestedReduceAmount: null
    });
    const trimLike = review({
      eventId: "b",
      symbol: "MSFT",
      occurredAt: "2026-09-15",
      adviceAction: "hold",
      adviceSuggestedReduceAmount: 40
    });
    const rows = buildAdviceEpisodeRows([hold, trimLike]);
    expect(rows).toHaveLength(2);
    expect(episodeCallLabel(rows[0])).toBe("Trim");
    expect(episodeCallLabel(rows[1])).toBe("Hold");
  });

  test("treats hold-with-reduce and later trim as one call", () => {
    const holdReduce = review({
      eventId: "a",
      symbol: "NVDA",
      occurredAt: "2026-09-14",
      adviceAction: "hold",
      adviceSuggestedReduceAmount: 40,
      priceAtAdvice: 212
    });
    const trim = review({
      eventId: "b",
      symbol: "NVDA",
      occurredAt: "2026-09-16",
      adviceAction: "trim",
      adviceSuggestedReduceAmount: 50,
      priceAtAdvice: 212
    });
    const rows = buildAdviceEpisodeRows([holdReduce, trim]);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toBe("2026-09-14");
    expect(episodeCallLabel(rows[0])).toBe("Trim");
  });

  test("hides pending results and only labels exceptions", () => {
    const openHold = review({ symbol: "NVDA", occurredAt: "2026-09-15" });
    const openSell = review({
      eventId: "r-sell",
      symbol: "ARKQ",
      occurredAt: "2026-09-10",
      adviceAction: "sell"
    });
    const scored = review({
      eventId: "r2",
      symbol: "WMT",
      occurredAt: "2026-08-01",
      adviceAction: "sell",
      outcome30d: "favorable"
    });
    expect(episodeResultLabel({ outcome30d: null, outcome90d: null })).toBe("");
    expect(episodeResultLabel({ outcome30d: "favorable", outcome90d: null })).toBe("30d favorable");
    expect(episodeStanceLabel({ followThrough: "followed" })).toBe("");
    expect(episodeStanceLabel({ followThrough: "ignored" })).toBe("");
    expect(episodeStanceLabel({ followThrough: "diverged" })).toBe("Sold");
    const holdRow = buildAdviceEpisodeRows([openHold])[0];
    const sellRow = buildAdviceEpisodeRows([openSell])[0];
    const scoredRow = buildAdviceEpisodeRows([scored, sale({ symbol: "WMT" })])[0];
    expect(episodeAfterLabel(holdRow)).toBe("");
    expect(episodeAfterLabel(sellRow)).toBe("");
    expect(episodeAfterLabel(scoredRow)).toBe("30d favorable");
    const rows = buildAdviceEpisodeRows([openHold, scored]);
    expect(adviceTrackSummaryLine(rows)).toMatch(/2 recommendations/);
    expect(adviceTrackSummaryLine(rows)).toMatch(/1 scored/);
    expect(adviceTrackSummaryLine(rows)).not.toMatch(/pending/i);
  });

  test("list keeps the current call per symbol and older calls only when After has meaning", () => {
    const oldTrim = review({
      eventId: "c1",
      symbol: "CRWD",
      occurredAt: "2026-09-14",
      adviceAction: "trim",
      adviceSuggestedReduceAmount: 20
    });
    const newHold = review({
      eventId: "c2",
      symbol: "CRWD",
      occurredAt: "2026-09-16",
      adviceAction: "hold"
    });
    const scoredSell = review({
      eventId: "w1",
      symbol: "WMT",
      occurredAt: "2026-08-01",
      adviceAction: "sell",
      outcome30d: "favorable"
    });
    const laterHold = review({
      eventId: "w2",
      symbol: "WMT",
      occurredAt: "2026-09-14",
      adviceAction: "hold"
    });
    const listed = selectAdviceTrackRows(
      buildAdviceEpisodeRows([oldTrim, newHold, scoredSell, laterHold])
    );
    expect(listed.map((r) => `${r.symbol}:${episodeCallLabel(r)}:${r.startedAt}`)).toEqual([
      "CRWD:Hold:2026-09-16",
      "WMT:Hold:2026-09-14",
      "WMT:Sell:2026-08-01"
    ]);
    expect(adviceTrackSinceLine("2026-09-14", "$212.39")).toBe("since Sep 14 at $212.39");
    expect(adviceTrackSinceLine("2026-09-14", "—")).toBe("since Sep 14");
  });
});

describe("advice track size and now-vs-then", () => {
  test("hold stays badge-only; trim/add/sell show already-computed dollars", () => {
    const hold = buildAdviceEpisodeRows([review({ adviceAction: "hold" })])[0];
    expect(episodeCallSizeLabel(hold)).toBe("");
    const trim = buildAdviceEpisodeRows([
      review({
        eventId: "t",
        adviceAction: "trim",
        adviceSuggestedReduceAmount: 2100
      })
    ])[0];
    expect(episodeCallSizeLabel(trim)).toBe("$2,100.00");
    const add = buildAdviceEpisodeRows([
      review({
        eventId: "a",
        adviceAction: "hold",
        adviceSuggestedAddAmount: 800
      })
    ])[0];
    expect(episodeCallLabel(add)).toBe("Add");
    expect(episodeCallSizeLabel(add)).toBe("$800.00");
    const buyMore = buildAdviceEpisodeRows([
      review({
        eventId: "b",
        adviceAction: "buy_more",
        adviceSuggestedAddAmount: 1500
      })
    ])[0];
    expect(episodeCallSizeLabel(buyMore)).toBe("$1,500.00");
    const sell = buildAdviceEpisodeRows([
      review({
        eventId: "s",
        adviceAction: "sell",
        adviceSuggestedReduceAmount: 5400
      })
    ])[0];
    expect(episodeCallSizeLabel(sell)).toBe("$5,400.00");
    const emptyTrim = buildAdviceEpisodeRows([
      review({ eventId: "e", adviceAction: "trim", adviceSuggestedReduceAmount: null })
    ])[0];
    expect(episodeCallSizeLabel(emptyTrim)).toBe("");
  });

  test("now-vs-then is a live move, not a 30/90d score", () => {
    expect(adviceTrackNowMove(100, null)).toBeNull();
    expect(adviceTrackNowMove(100, 0)).toBeNull();
    expect(adviceTrackNowMove(null, 122.92)).toEqual({
      label: "now $122.92",
      tone: "flat"
    });
    expect(adviceTrackNowMove(100, 102)).toEqual({
      label: "now $102.00 · +2.0%",
      tone: "up"
    });
    expect(adviceTrackNowMove(21.02, 20.18)).toEqual({
      label: "now $20.18 · -4.0%",
      tone: "down"
    });
    expect(adviceTrackNowMove(50, 50)).toEqual({
      label: "now $50.00 · 0.0%",
      tone: "flat"
    });
  });
});
