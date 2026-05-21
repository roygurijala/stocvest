import { describe, expect, test } from "vitest";
import { watchlistMaxSymbolsForPlan } from "@/lib/subscription-access";

describe("watchlistMaxSymbolsForPlan", () => {
  test("free tier allows 5 symbols", () => {
    expect(watchlistMaxSymbolsForPlan("free", false)).toBe(5);
  });

  test("swing pro allows 50 symbols", () => {
    expect(watchlistMaxSymbolsForPlan("swing_pro", false)).toBe(50);
  });

  test("swing + day pro allows 100 symbols", () => {
    expect(watchlistMaxSymbolsForPlan("swing_day_pro", false)).toBe(100);
  });

  test("full access override uses 100", () => {
    expect(watchlistMaxSymbolsForPlan("free", true)).toBe(100);
  });
});
