import { describe, expect, test } from "vitest";

import {
  deskSessionTradingDate,
  isDeskSessionActivityStale,
  nyTradingDateIso
} from "@/lib/dashboard/desk-session-freshness";

describe("desk-session-freshness", () => {
  test("nyTradingDateIso uses America/New_York", () => {
    const d = new Date("2026-05-27T12:00:00.000Z");
    expect(nyTradingDateIso(d)).toBe("2026-05-27");
  });

  test("isDeskSessionActivityStale when session_trading_date is prior day during live", () => {
    expect(
      isDeskSessionActivityStale(
        { session_trading_date: "2026-05-26", generated_at: "2026-05-26T20:00:00.000Z" },
        "live"
      )
    ).toBe(true);
  });

  test("isDeskSessionActivityStale false for closed post-close log", () => {
    expect(
      isDeskSessionActivityStale(
        { session_trading_date: "2026-05-26", generated_at: "2026-05-26T20:00:00.000Z" },
        "closed"
      )
    ).toBe(false);
  });

  test("deskSessionTradingDate falls back to generated_at ET date", () => {
    expect(deskSessionTradingDate({ generated_at: "2026-05-27T13:30:00.000Z" })).toBe("2026-05-27");
  });
});
