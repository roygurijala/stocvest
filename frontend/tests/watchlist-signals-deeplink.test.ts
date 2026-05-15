import { describe, expect, test } from "vitest";

import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";

describe("watchlistToSignalsHref", () => {
  test("includes symbol and ref=watchlist", () => {
    const href = watchlistToSignalsHref("aapl");
    expect(href).toMatch(/^\/dashboard\/signals\?/);
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("symbol")).toBe("AAPL");
    expect(u.searchParams.get("ref")).toBe("watchlist");
    expect(u.searchParams.get("trading_mode")).toBeNull();
  });

  test("optional trading_mode", () => {
    const href = watchlistToSignalsHref("MSFT", "day");
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("trading_mode")).toBe("day");
  });

  test("blank symbol falls back to bare Signals path", () => {
    expect(watchlistToSignalsHref("")).toBe("/dashboard/signals");
    expect(watchlistToSignalsHref("   ")).toBe("/dashboard/signals");
  });
});

describe("watchlistSignalsOpenAriaLabel", () => {
  test("includes ticker when present", () => {
    expect(watchlistSignalsOpenAriaLabel("nvda")).toBe("Open NVDA on Signals");
  });

  test("generic label when ticker blank", () => {
    expect(watchlistSignalsOpenAriaLabel("")).toBe("Open Signals");
  });
});
