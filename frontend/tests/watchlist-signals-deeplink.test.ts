import { describe, expect, test } from "vitest";

import {
  scannerOpenEvidenceHref,
  watchlistSignalsOpenAriaLabel,
  watchlistToSignalsHref
} from "@/lib/nav/watchlist-signals-deeplink";

describe("watchlistToSignalsHref", () => {
  test("includes symbol, lane, and ref=watchlist", () => {
    const href = watchlistToSignalsHref("aapl");
    expect(href).toMatch(/^\/dashboard\?/);
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("symbol")).toBe("AAPL");
    expect(u.searchParams.get("ref")).toBe("watchlist");
    expect(u.searchParams.get("lane")).toBe("swing");
  });

  test("optional trading_mode maps to lane", () => {
    const href = watchlistToSignalsHref("MSFT", "day");
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("lane")).toBe("day");
  });

  test("blank symbol falls back to dashboard", () => {
    expect(watchlistToSignalsHref("")).toBe("/dashboard");
    expect(watchlistToSignalsHref("   ")).toBe("/dashboard");
  });
});

describe("scannerOpenEvidenceHref", () => {
  test("opens trading room deep-dive for scanner context", () => {
    const href = scannerOpenEvidenceHref("powi", "swing");
    const u = new URL(href, "http://local.test");
    expect(u.pathname).toBe("/dashboard");
    expect(u.searchParams.get("symbol")).toBe("POWI");
    expect(u.searchParams.get("ref")).toBe("scanner");
    expect(u.searchParams.get("lane")).toBe("swing");
  });
});

describe("watchlistSignalsOpenAriaLabel", () => {
  test("includes ticker when present", () => {
    expect(watchlistSignalsOpenAriaLabel("nvda")).toBe("Open NVDA in Trading Room");
  });

  test("generic label when ticker blank", () => {
    expect(watchlistSignalsOpenAriaLabel("")).toBe("Open Trading Room");
  });
});
