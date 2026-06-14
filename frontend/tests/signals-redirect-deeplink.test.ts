import { describe, expect, test } from "vitest";
import { legacySignalsRedirectHref } from "@/lib/nav/dashboard-trading-room-deeplink";

describe("legacy signals redirect", () => {
  test("maps symbol and trading_mode to dashboard deep-dive", () => {
    expect(
      legacySignalsRedirectHref({ symbol: "AAPL", trading_mode: "swing", ref: "scanner" })
    ).toBe("/dashboard?symbol=AAPL&lane=swing&ref=scanner");
  });

  test("blank symbol goes to dashboard", () => {
    expect(legacySignalsRedirectHref({ symbol: "", trading_mode: "day" })).toBe("/dashboard");
  });
});
