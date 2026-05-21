import { describe, expect, it } from "vitest";
import {
  MIN_DEVELOPING_ALIGNED,
  buildDevelopingMovementGroups,
  buildNearReadyCards,
  buildQuietBridgeLine,
  buildScanOutcomePrimaryBlocker,
  buildScanOutcomeWatchHint,
  buildVolumeProximityLeads,
  buildWhatWouldChangeContent,
  nearReadySectionCopy,
  regimeBlocksDesk,
  regimeGateRejectionContext,
  regimeGateRejectionTitle,
  synthesizeWhatWouldChange,
  volumeLeadToNearReadyCard
} from "@/lib/scanner/scanner-quiet-desk";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
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
  desk: "swing" | "day" = "swing",
  state = "developing"
): ScannerWatchlistProgressionRow => ({
  symbol,
  desk,
  state,
  label: "Developing",
  layers_aligned: aligned,
  layers_total: 6,
  layers_away: 6 - aligned
});

describe("scanner-quiet-desk", () => {
  it("builds near-ready cards with urgency when regime blocks", () => {
    const cards = buildNearReadyCards([nearRow("AAPL", 5)], "Bearish", "all");
    expect(cards).toHaveLength(1);
    expect(cards[0].alignmentHeadline).toMatch(/5\/6 aligned/);
    expect(cards[0].blockedLine).toBe("Blocked by regime");
    expect(cards[0].urgencyLine).toMatch(/regime clears/i);
  });

  it("near ready section copy reflects regime gate", () => {
    expect(nearReadySectionCopy("Bearish").title).toMatch(/Blocked by Regime/i);
    expect(nearReadySectionCopy("Bullish").title).toBe("Near Ready");
  });

  it("groups developing rows by movement and filters below MIN aligned", () => {
    const groups = buildDevelopingMovementGroups(
      [
        progressionRow("MSFT", 5),
        progressionRow("GOOG", 3),
        progressionRow("NVDA", 2),
        progressionRow("NVDA", 3, "swing", "invalidated")
      ],
      "all",
      new Set()
    );
    expect(groups.improving.map((r) => r.symbol)).toEqual(["MSFT"]);
    expect(groups.stable.map((r) => r.symbol)).toEqual(["GOOG"]);
    expect(groups.weakening.map((r) => r.symbol)).toEqual(["NVDA"]);
    expect(MIN_DEVELOPING_ALIGNED).toBe(3);
  });

  it("shows desk on symbol when filter is all", () => {
    const groups = buildDevelopingMovementGroups(
      [progressionRow("AAPL", 4, "swing"), progressionRow("AAPL", 4, "day")],
      "all",
      new Set()
    );
    const labels = [...groups.stable, ...groups.improving, ...groups.weakening].map(
      (r) => r.displaySymbol
    );
    expect(labels).toContain("AAPL (swing)");
    expect(labels).toContain("AAPL (day)");
  });

  it("excludes near-ready symbols from developing groups", () => {
    const groups = buildDevelopingMovementGroups(
      [progressionRow("AAPL", 4), progressionRow("MSFT", 5)],
      "all",
      new Set(["AAPL"])
    );
    expect(groups.improving.map((r) => r.symbol)).toEqual(["MSFT"]);
  });

  it("builds quiet bridge line when near-ready exist", () => {
    expect(buildQuietBridgeLine(0, 2, "Bearish")).toMatch(/near-ready blocked/i);
  });

  it("builds scan outcome primary blocker for volume", () => {
    expect(buildScanOutcomePrimaryBlocker(0, 10)).toMatch(/low volume across 10 symbols/i);
    expect(buildScanOutcomePrimaryBlocker(1, 10)).toBeNull();
  });

  it("builds one-line scan outcome watch hint", () => {
    expect(buildScanOutcomeWatchHint(["NVDA", "QQQ"])).toMatch(/first in NVDA \/ QQQ/i);
    expect(buildScanOutcomeWatchHint([])).toBeNull();
  });

  it("builds structured what-would-change content", () => {
    const content = buildWhatWouldChangeContent(null, "Bearish", ["AAPL"]);
    expect(content.watchItems.length).toBeGreaterThan(0);
    expect(content.outcome).toContain("AAPL");
  });

  it("volume proximity leads sort by lowest pct_below and map to near-ready cards", () => {
    const synthesis = {
      qualified_count: 0,
      market_summary: "",
      what_would_change: "",
      session_time_et: "10:00",
      volume_context: { market_condition: "low" },
      near_misses: [],
      rejection_groups: {
        session_volume: [
          { symbol: "TSLA", pct_below: 85 },
          { symbol: "NVDA", pct_below: 12 }
        ],
        liquidity: [],
        structure: []
      }
    } as ScannerSynthesis;
    const leads = buildVolumeProximityLeads(synthesis, new Set(), 2);
    expect(leads.map((l) => l.symbol)).toEqual(["NVDA", "TSLA"]);
    const card = volumeLeadToNearReadyCard(leads[0], "Bullish", 0);
    expect(card.readinessHint).toMatch(/Nearest to qualifying on volume/i);
    expect(card.blockedLine).toMatch(/session volume — not regime/i);
    const change = buildWhatWouldChangeContent(synthesis, "Bullish", [], ["NVDA", "SPY"]);
    expect(change.outcome).toMatch(/Volume pickup in NVDA and SPY/i);
  });

  it("regime gate helpers and blocks desk", () => {
    expect(regimeBlocksDesk("Bearish")).toBe(true);
    expect(regimeGateRejectionTitle(2, "Bearish")).toMatch(/Blocked by Regime \(2/);
    expect(regimeGateRejectionContext("Bearish", -0.5, -0.7)).toMatch(/SPY\/QQQ/i);
  });

  it("synthesizeWhatWouldChange legacy string includes bullets", () => {
    const text = synthesizeWhatWouldChange(null, "Bearish", ["AAPL"]);
    expect(text).toContain("•");
  });
});
