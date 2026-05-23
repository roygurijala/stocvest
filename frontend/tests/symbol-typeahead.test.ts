import { describe, expect, test } from "vitest";
import {
  buildRankedSymbolSuggestions,
  finalizeTickerSearchItems,
  injectTypedTickerCandidate
} from "@/lib/symbol-typeahead";

describe("symbol-typeahead", () => {
  test("injectTypedTickerCandidate adds GS when missing from pool", () => {
    const out = injectTypedTickerCandidate([{ symbol: "GSHD", label: "GSHD — Goosehead Insurance" }], "GS");
    expect(out.some((c) => c.symbol === "GS")).toBe(true);
  });

  test("buildRankedSymbolSuggestions ranks exact typed ticker first", () => {
    const out = buildRankedSymbolSuggestions(
      [
        { symbol: "GSHD", label: "GSHD — Goosehead Insurance" },
        { symbol: "GSM", label: "GSM — Ferroglobe" }
      ],
      "GS",
      5
    );
    expect(out[0]?.symbol).toBe("GS");
  });

  test("buildRankedSymbolSuggestions includes COIN for query COIN", () => {
    const out = buildRankedSymbolSuggestions([], "COIN", 5);
    expect(out).toEqual([{ symbol: "COIN", label: "COIN" }]);
  });

  test("finalizeTickerSearchItems prepends exact ticker", () => {
    expect(finalizeTickerSearchItems("GS", [{ symbol: "GSHD", name: "Goosehead" }])).toEqual([
      { symbol: "GS", name: "" },
      { symbol: "GSHD", name: "Goosehead" }
    ]);
  });

  test("finalizeTickerSearchItems is idempotent when exact ticker already present", () => {
    const items = [{ symbol: "COIN", name: "Coinbase Global, Inc." }];
    expect(finalizeTickerSearchItems("COIN", items)).toEqual(items);
  });
});
