import { describe, expect, test } from "vitest";

import { isTickerSearchQueryReady, TICKER_SEARCH_MIN_QUERY_LENGTH } from "@/lib/ticker-search-query";

describe("ticker-search-query", () => {
  test("minimum length is 1 for single-letter tickers", () => {
    expect(TICKER_SEARCH_MIN_QUERY_LENGTH).toBe(1);
  });

  test("isTickerSearchQueryReady accepts one character", () => {
    expect(isTickerSearchQueryReady("F")).toBe(true);
    expect(isTickerSearchQueryReady(" f ")).toBe(true);
  });

  test("isTickerSearchQueryReady rejects empty", () => {
    expect(isTickerSearchQueryReady("")).toBe(false);
    expect(isTickerSearchQueryReady("   ")).toBe(false);
  });
});
