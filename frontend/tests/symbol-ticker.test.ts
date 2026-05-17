import { describe, expect, test } from "vitest";
import {
  canonicalUsTicker,
  canonicalUsTickerFromSearch,
  tickersEquivalent
} from "@/lib/symbol-ticker";

describe("symbol-ticker", () => {
  test("class share dot and dash canonicalize to dot form", () => {
    expect(canonicalUsTicker("brk.b")).toBe("BRK.B");
    expect(canonicalUsTicker("BRK-B")).toBe("BRK.B");
    expect(canonicalUsTickerFromSearch("BRK-B")).toBe("BRK.B");
  });

  test("tickersEquivalent treats dash and dot as same", () => {
    expect(tickersEquivalent("BRK-B", "BRK.B")).toBe(true);
  });

  test("plain tickers unchanged", () => {
    expect(canonicalUsTicker("intc")).toBe("INTC");
    expect(canonicalUsTicker("aapl")).toBe("AAPL");
  });
});
