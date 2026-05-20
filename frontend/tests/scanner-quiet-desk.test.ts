import { describe, expect, it } from "vitest";
import {
  buildDevelopingMovementGroups,
  buildNearReadyCards,
  nearReadySectionCopy,
  regimeBlocksDesk,
  regimeGateRejectionContext,
  regimeGateRejectionTitle,
  synthesizeWhatWouldChange
} from "@/lib/scanner/scanner-quiet-desk";
import type {
  ScannerNearQualificationRow,
  ScannerWatchlistProgressionRow
} from "@/lib/scanner-scan-summary";

const nearRow = (symbol: string, aligned: number): ScannerNearQualificationRow => ({
  symbol,
  desk: "swing",
  score: 0.72,
  direction: "long",
  alignment: { aligned, total: 6, layers: [] },
  layers_away: 6 - aligned
});

const progressionRow = (
  symbol: string,
  aligned: number,
  state = "developing"
): ScannerWatchlistProgressionRow => ({
  symbol,
  desk: "swing",
  state,
  label: "Developing",
  layers_aligned: aligned,
  layers_total: 6,
  layers_away: 6 - aligned
});

describe("scanner-quiet-desk", () => {
  it("builds near-ready cards when alignment is high", () => {
    const cards = buildNearReadyCards([nearRow("AAPL", 5)], "Bearish", "all");
    expect(cards).toHaveLength(1);
    expect(cards[0].symbol).toBe("AAPL");
    expect(cards[0].blockedLine).toBe("Blocked by regime");
  });

  it("near ready section copy reflects regime gate", () => {
    expect(nearReadySectionCopy("Bearish").title).toMatch(/Blocked by Regime/i);
    expect(nearReadySectionCopy("Bullish").title).toBe("Near Ready");
  });

  it("groups developing rows by movement bucket", () => {
    const groups = buildDevelopingMovementGroups(
      [
        progressionRow("MSFT", 5),
        progressionRow("GOOG", 3),
        progressionRow("NVDA", 2, "invalidated")
      ],
      "all",
      new Set()
    );
    expect(groups.improving.map((r) => r.symbol)).toEqual(["MSFT"]);
    expect(groups.stable.map((r) => r.symbol)).toEqual(["GOOG"]);
    expect(groups.weakening.map((r) => r.symbol)).toEqual(["NVDA"]);
  });

  it("excludes near-ready symbols from developing groups", () => {
    const groups = buildDevelopingMovementGroups(
      [progressionRow("AAPL", 4), progressionRow("MSFT", 5)],
      "all",
      new Set(["AAPL"])
    );
    expect(groups.improving.map((r) => r.symbol)).toEqual(["MSFT"]);
  });

  it("synthesizes what would change with regime and symbols", () => {
    const text = synthesizeWhatWouldChange(null, "Bearish", ["AAPL", "MSFT"]);
    expect(text).toContain("AAPL");
    expect(text).toMatch(/regime clears/i);
  });

  it("regime gate helpers and blocks desk", () => {
    expect(regimeBlocksDesk("Bearish")).toBe(true);
    expect(regimeGateRejectionTitle(2, "Bearish")).toMatch(/Blocked by Regime \(2/);
    expect(regimeGateRejectionContext("Bearish", -0.5, -0.7)).toMatch(/SPY\/QQQ/i);
  });
});
