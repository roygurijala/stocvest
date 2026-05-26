import { describe, expect, test } from "vitest";

import {
  buildScannerSymbolUniverse,
  capScannerUniverse,
  scannerUniverseCapPriority,
  symbolsFromDeskSlice,
  topGapSymbolsForUniverse
} from "@/lib/dashboard/scanner-universe";
import type { GapIntelligenceItem } from "@/lib/api/scanner";

describe("scanner universe", () => {
  test("merges desk discovery and movers", () => {
    const syms = symbolsFromDeskSlice({
      discovery: [{ symbol: "MU" }],
      movers_radar: [{ symbol: "NVDA" }, { symbol: "MU" }]
    });
    expect(syms).toEqual(["MU", "NVDA"]);
  });

  test("desk symbol wins cap priority over watchlist-only name", () => {
    const desk = ["MU"];
    const gap = ["AMD"];
    const watch = ["ZZZ"];
    const universe = buildScannerSymbolUniverse({
      watchlist: watch,
      gapSymbols: gap,
      deskSymbols: desk
    });
    const capped = capScannerUniverse(
      [...universe, "AAPL", "MSFT", "GOOGL", "META", "TSLA"].slice(0, 6),
      5,
      scannerUniverseCapPriority({ deskSymbols: desk, gapSymbols: gap, watchlist: watch })
    );
    expect(capped).toContain("MU");
    expect(capped).toContain("SPY");
    expect(capped).toContain("QQQ");
  });

  test("topGapSymbolsForUniverse sorts by abs gap quality", () => {
    const items: GapIntelligenceItem[] = [
      { symbol: "LOW", gap_pct: 3, has_catalyst: false },
      { symbol: "HIGH", gap_pct: 12, has_catalyst: false }
    ];
    expect(topGapSymbolsForUniverse(items, 1)).toEqual(["HIGH"]);
  });
});
