import { describe, expect, test } from "vitest";
import {
  collectStaleWatchlistSymbols,
  evaluatedTradingDateEt,
  isMaturationStaleForTodaySession,
  nyTradingDateIso
} from "@/lib/watchlist-maturation-session-staleness";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

describe("watchlist maturation session staleness", () => {
  test("nyTradingDateIso uses America/New_York calendar date", () => {
    const d = new Date("2026-05-27T03:00:00.000Z");
    expect(nyTradingDateIso(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("missing row is stale for today", () => {
    expect(isMaturationStaleForTodaySession(undefined, "2026-05-27")).toBe(true);
  });

  test("evaluation on prior NY day is stale", () => {
    const row = {
      last_evaluated_at: "2026-05-24T14:00:00.000Z"
    } as WatchlistMaturationRow;
    expect(isMaturationStaleForTodaySession(row, "2026-05-27")).toBe(true);
  });

  test("evaluation on same NY day is not stale", () => {
    const session = "2026-05-27";
    const row = {
      last_evaluated_at: "2026-05-27T14:00:00.000Z"
    } as WatchlistMaturationRow;
    expect(evaluatedTradingDateEt(row.last_evaluated_at)).toBe(session);
    expect(isMaturationStaleForTodaySession(row, session)).toBe(false);
  });

  test("collectStaleWatchlistSymbols returns desk-specific work", () => {
    const stale = collectStaleWatchlistSymbols(
      ["GS", "SPY"],
      ["swing"],
      {
        GS: { last_evaluated_at: "2026-05-24T12:00:00.000Z" } as WatchlistMaturationRow,
        SPY: { last_evaluated_at: "2026-05-27T12:00:00.000Z" } as WatchlistMaturationRow
      },
      {},
      "2026-05-27"
    );
    expect(stale).toEqual([{ symbol: "GS", desk: "swing" }]);
  });
});
