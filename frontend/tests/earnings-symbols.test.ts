import { describe, expect, test } from "vitest";
import {
  DEFAULT_EARNINGS_SYMBOLS,
  normalizeEarningsResponse,
  resolveEarningsSymbolList
} from "@/lib/api/earnings-types";

describe("resolveEarningsSymbolList", () => {
  test("watchlist symbols precede defaults and dedupe", () => {
    const out = resolveEarningsSymbolList(DEFAULT_EARNINGS_SYMBOLS, ["DELL", "AAPL"], { max: 30 });
    expect(out[0]).toBe("DELL");
    expect(out[1]).toBe("AAPL");
    expect(out.filter((s) => s === "AAPL")).toHaveLength(1);
  });

  test("respects max cap", () => {
    const out = resolveEarningsSymbolList(["A", "B", "C"], ["X", "Y"], { max: 3 });
    expect(out).toEqual(["X", "Y", "A"]);
  });
});

describe("normalizeEarningsResponse", () => {
  test("preserves source from API payload", () => {
    const normalized = normalizeEarningsResponse(["DELL"], 30, {
      symbols: ["DELL"],
      days: 30,
      upcoming: [],
      recent: [],
      source: "finnhub"
    });
    expect(normalized.source).toBe("finnhub");
  });
});
