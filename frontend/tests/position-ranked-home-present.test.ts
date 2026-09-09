import { describe, expect, it } from "vitest";

import {
  applyPositionGemFilter,
  buildPositionGemDisplayRows,
  buildPositionGemRailItems,
  buildWatchlistQualityBadge,
  buildWatchlistQualityMap,
  DEFAULT_POSITION_GEM_FILTER,
  parsePositionCandidates,
  parsePositionGemFilterFromParams,
  positionGemFilterToQuery,
  positionGemTierCopy,
  positionGemTierLabel,
  type PositionGemCandidate
} from "@/lib/dashboard/position-ranked-home-present";
import { watchlistQualityDotColor } from "@/lib/dashboard/trading-room/watchlist-rail-present";

function apiRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "AAPL",
    tier: "gem",
    rank: 78.5,
    composite_score: 40,
    verdict: "bullish",
    fundamentals_score: 80,
    fundamentals_verdict: "bullish",
    technical_score: 66,
    technical_verdict: "bullish",
    sector_verdict: "neutral",
    data_quality: "high",
    weakest_pillar_id: "F4",
    weakest_pillar_label: "Valuation",
    rs_vs_spy_6m_pct: 8.2,
    signal_valid_days: 90,
    why: "Passes strict quality gates — weakest F4 valuation. Screening only.",
    pillars: [
      { pillar_id: "F1", label: "Profitability & quality", score: 80, verdict: "bullish", data_quality: "high" }
    ],
    failing_gates: [],
    ...overrides
  };
}

describe("position-ranked-home-present", () => {
  it("parses the candidates API envelope defensively", () => {
    const parsed = parsePositionCandidates({
      tier: "gem",
      candidates: [apiRow(), apiRow({ symbol: "msft", tier: "strong" }), { symbol: "" }, null],
      count: 2,
      universe_size: 25,
      scan_generated_at: "2026-09-08T00:00:00+00:00",
      cached: true
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.candidates.map((c) => c.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(parsed?.candidates[1].tier).toBe("strong");
    expect(parsed?.universeSize).toBe(25);
    expect(parsed?.cached).toBe(true);
  });

  it("returns null for non-object input", () => {
    expect(parsePositionCandidates(null)).toBeNull();
    expect(parsePositionCandidates("nope")).toBeNull();
  });

  it("filters by tier, min scores, and symbol query", () => {
    const cands: PositionGemCandidate[] = parsePositionCandidates({
      candidates: [
        apiRow({ symbol: "AAA", tier: "gem", fundamentals_score: 85, technical_score: 70 }),
        apiRow({ symbol: "BBB", tier: "gem", fundamentals_score: 74, technical_score: 40 }),
        apiRow({ symbol: "CCC", tier: "strong", fundamentals_score: 90, technical_score: 80 })
      ]
    })!.candidates;

    expect(applyPositionGemFilter(cands, { ...DEFAULT_POSITION_GEM_FILTER, tier: "gem" }).map((c) => c.symbol)).toEqual([
      "AAA",
      "BBB"
    ]);
    expect(
      applyPositionGemFilter(cands, { ...DEFAULT_POSITION_GEM_FILTER, tier: "gem", minTechnical: 50 }).map((c) => c.symbol)
    ).toEqual(["AAA"]);
    expect(
      applyPositionGemFilter(cands, { ...DEFAULT_POSITION_GEM_FILTER, tier: "all", symbolQuery: "cc" }).map((c) => c.symbol)
    ).toEqual(["CCC"]);
  });

  it("builds display rows with a Position deep-dive href and weakest pillar", () => {
    const cands = parsePositionCandidates({ candidates: [apiRow()] })!.candidates;
    const rows = buildPositionGemDisplayRows(cands);
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toContain("symbol=AAPL");
    expect(rows[0].href).toContain("lane=position");
    expect(rows[0].tierLabel).toBe("Gem candidate");
    expect(rows[0].fundamentalsLabel).toBe("Bullish");
    expect(rows[0].weakestLabel).toBe("F4 · Valuation");
  });

  it("shows an em dash when no weakest pillar is present", () => {
    const cands = parsePositionCandidates({
      candidates: [apiRow({ weakest_pillar_id: null, weakest_pillar_label: null })]
    })!.candidates;
    expect(buildPositionGemDisplayRows(cands)[0].weakestLabel).toBe("—");
  });

  it("round-trips shareable filter query params", () => {
    const filter = parsePositionGemFilterFromParams(
      new URLSearchParams("tier=strong&fund=min:70&tech=min:55&q=nvda")
    );
    expect(filter).toEqual({ tier: "strong", minFundamentals: 70, minTechnical: 55, symbolQuery: "NVDA" });
    const qs = positionGemFilterToQuery(filter);
    expect(parsePositionGemFilterFromParams(new URLSearchParams(qs))).toEqual(filter);
  });

  it("defaults unknown tier to gem", () => {
    expect(parsePositionGemFilterFromParams(new URLSearchParams("tier=banana")).tier).toBe("gem");
  });

  it("exposes non-advisory tier copy and labels", () => {
    expect(positionGemTierLabel("gem")).toBe("Gem candidate");
    const copy = positionGemTierCopy("strong");
    expect(copy.toLowerCase()).not.toContain("buy");
    expect(copy.toLowerCase()).not.toContain("recommend");
  });
});

describe("position watchlist quality badge (POS-D14)", () => {
  it("builds a badge with tier short label and weakest-pillar tooltip", () => {
    const cand = parsePositionCandidates({ candidates: [apiRow({ tier: "gem" })] })!.candidates[0];
    const badge = buildWatchlistQualityBadge(cand);
    expect(badge).not.toBeNull();
    expect(badge!.tier).toBe("gem");
    expect(badge!.short).toBe("Gem");
    expect(badge!.tooltip).toBe("Gem candidate — weakest pillar: F4 · Valuation");
  });

  it("omits the weakest-pillar clause when no weakest pillar is present", () => {
    const cand = parsePositionCandidates({
      candidates: [apiRow({ tier: "strong", weakest_pillar_id: null, weakest_pillar_label: null })]
    })!.candidates[0];
    const badge = buildWatchlistQualityBadge(cand);
    expect(badge!.short).toBe("Strong");
    expect(badge!.tooltip).toBe("Strong quality");
  });

  it("never badges insufficient candidates or null input", () => {
    const cand = parsePositionCandidates({ candidates: [apiRow({ tier: "insufficient" })] })!.candidates[0];
    expect(buildWatchlistQualityBadge(cand)).toBeNull();
    expect(buildWatchlistQualityBadge(null)).toBeNull();
    expect(buildWatchlistQualityBadge(undefined)).toBeNull();
  });

  it("maps symbols (uppercased) to badges and skips insufficient rows", () => {
    const cands = parsePositionCandidates({
      candidates: [
        apiRow({ symbol: "aapl", tier: "gem" }),
        apiRow({ symbol: "MSFT", tier: "strong" }),
        apiRow({ symbol: "XYZ", tier: "monitor" }),
        apiRow({ symbol: "BAD", tier: "insufficient" })
      ]
    })!.candidates;
    const map = buildWatchlistQualityMap(cands);
    expect([...map.keys()].sort()).toEqual(["AAPL", "MSFT", "XYZ"]);
    expect(map.get("AAPL")!.tier).toBe("gem");
    expect(map.get("XYZ")!.short).toBe("Monitor");
    expect(map.get("BAD")).toBeUndefined();
    expect(buildWatchlistQualityMap(null).size).toBe(0);
  });

  it("colors gem gold, strong bullish, monitor muted", () => {
    const colors = { bullish: "#0a0", textMuted: "#888" };
    expect(watchlistQualityDotColor("gem", colors)).toBe("#fbbf24");
    expect(watchlistQualityDotColor("strong", colors)).toBe("#0a0");
    expect(watchlistQualityDotColor("monitor", colors)).toBe("#888");
  });

  // ADR-004 POS-D8 — Trading Room gem rail
  it("builds the gem rail: gems first, then strong, excluding monitor/insufficient", () => {
    const cands = parsePositionCandidates({
      candidates: [
        apiRow({ symbol: "KO", tier: "strong" }),
        apiRow({ symbol: "MSFT", tier: "gem" }),
        apiRow({ symbol: "XYZ", tier: "monitor" }),
        apiRow({ symbol: "BAD", tier: "insufficient" }),
        apiRow({ symbol: "AAPL", tier: "gem" })
      ]
    })!.candidates;
    const items = buildPositionGemRailItems(cands);
    // Gems (in source order) before strong; monitor + insufficient dropped.
    expect(items.map((i) => i.symbol)).toEqual(["MSFT", "AAPL", "KO"]);
    expect(items.map((i) => i.tier)).toEqual(["gem", "gem", "strong"]);
    expect(items[0].tierShort).toBe("Gem");
    expect(items[2].tierShort).toBe("Strong");
    // Deep-links to the Position tab (Journey B) with the gem-rail ref.
    expect(items[0].href).toContain("symbol=MSFT");
    expect(items[0].href).toContain("lane=position");
    expect(items[0].href).toContain("ref=gem-rail");
    expect(items[0].weakestLabel).toBe("F4 · Valuation");
  });

  it("gem rail respects the limit and degrades to empty on null/zero", () => {
    const cands = parsePositionCandidates({
      candidates: [
        apiRow({ symbol: "A", tier: "gem" }),
        apiRow({ symbol: "B", tier: "gem" }),
        apiRow({ symbol: "C", tier: "strong" })
      ]
    })!.candidates;
    expect(buildPositionGemRailItems(cands, 2).map((i) => i.symbol)).toEqual(["A", "B"]);
    expect(buildPositionGemRailItems(cands, 0)).toEqual([]);
    expect(buildPositionGemRailItems(null)).toEqual([]);
    expect(buildPositionGemRailItems(undefined)).toEqual([]);
  });
});
