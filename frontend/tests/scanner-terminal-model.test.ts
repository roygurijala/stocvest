import { describe, expect, test } from "vitest";
import {
  buildScannerTerminalSections,
  dedupeDevelopingRows,
  gapFillWatchReason,
  isTickerSearchQuery,
  selectionTitle,
  splitDevelopingRows
} from "@/lib/scanner/terminal/scanner-terminal-model";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

describe("scanner-terminal-model", () => {
  test("partitions actionable and developing from setups", () => {
    const swingSetup: IntradaySetupPayload = {
      symbol: "NVDA",
      direction: "bullish",
      score: 82,
      triggers: ["EMA cross"],
      timestamp_iso: new Date().toISOString(),
      qualification_tier: "qualifying",
      alignment: { aligned: 5, total: 6, label: "5/6 layers" },
      scanner_mode: "swing_daily"
    };
    const nearSetup: IntradaySetupPayload = {
      symbol: "AMD",
      direction: "bullish",
      score: 58,
      triggers: ["Timing"],
      timestamp_iso: new Date().toISOString(),
      qualification_tier: "near",
      alignment: { aligned: 4, total: 6, label: "4/6 layers" }
    };

    const sections = buildScannerTerminalSections({
      filters: { mode: "all", state: "all", watchlistOnly: false, query: "" },
      gapIntelligence: [
        {
          symbol: "ORCL",
          company_name: "Oracle",
          gap_pct: 4.2,
          gap_dollars: 7,
          prev_close: 175,
          current_price: 182.4,
          volume: 1_000_000,
          volume_vs_avg: 1.5,
          gap_quality_score: 75,
          catalyst: null,
          has_catalyst: false,
          no_catalyst_warning: null,
          mode_best_fit: "swing"
        }
      ],
      setups: [swingSetup, nearSetup],
      swingDesk: null,
      dayDesk: null,
      nearQualification: [],
      dayTradingSurfaces: true,
      watchlistSymbols: new Set(),
      sectorRotation: [{ symbol: "XLK", label: "Tech", pct5d: 1.1 }]
    });

    expect(sections.gaps).toHaveLength(1);
    expect(sections.gaps[0]?.symbol).toBe("ORCL");
    expect(sections.gaps[0]?.gapQualityScore).toBe(75);
    expect(sections.gaps[0]?.fillWatchReason).not.toContain("75/100");
    expect(sections.actionable.some((r) => r.symbol === "NVDA")).toBe(true);
    expect(sections.actionable.find((r) => r.symbol === "NVDA")?.triggers).toContain("EMA cross");
    expect(sections.developing.some((r) => r.symbol === "AMD")).toBe(true);
    expect(sections.actionableCount).toBeGreaterThanOrEqual(1);
  });

  test("developing dedupes same symbol across day and swing desks", () => {
    const dayNear: IntradaySetupPayload = {
      symbol: "BFLY",
      direction: "bullish",
      score: 58,
      triggers: ["Timing"],
      timestamp_iso: new Date().toISOString(),
      qualification_tier: "near",
      alignment: { aligned: 3, total: 6, label: "3/6 layers" }
    };
    const swingNear: IntradaySetupPayload = {
      ...dayNear,
      scanner_mode: "swing_daily"
    };
    const sections = buildScannerTerminalSections({
      filters: { mode: "all", state: "all", watchlistOnly: false, query: "" },
      gapIntelligence: [],
      setups: [dayNear, swingNear],
      swingDesk: null,
      dayDesk: null,
      nearQualification: [],
      dayTradingSurfaces: true,
      watchlistSymbols: new Set()
    });
    expect(sections.developing.filter((r) => r.symbol === "BFLY")).toHaveLength(1);
  });

  test("ipo watch rows are separate from ranked gaps", () => {
    const sections = buildScannerTerminalSections({
      filters: { mode: "all", state: "all", watchlistOnly: false, query: "" },
      gapIntelligence: [],
      gapIpoWatch: [
        {
          symbol: "SPCX",
          company_name: "SpaceX",
          gap_pct: 8.4,
          gap_dollars: 10,
          prev_close: 120,
          current_price: 130,
          volume: 2_000_000,
          volume_vs_avg: 3,
          gap_quality_score: 80,
          catalyst: null,
          has_catalyst: false,
          no_catalyst_warning: null,
          ipo_watch: true,
          unscored: true,
          ipo_watch_note: "SpaceX · IPO day · not evaluated"
        }
      ],
      setups: [],
      swingDesk: null,
      dayDesk: null,
      nearQualification: [],
      dayTradingSurfaces: true,
      watchlistSymbols: new Set()
    });
    expect(sections.gaps).toHaveLength(0);
    expect(sections.ipoWatch).toHaveLength(1);
    expect(sections.ipoWatch[0]?.statusLabel).toBe("unscored");
  });

  test("query filter narrows gap rows", () => {
    const sections = buildScannerTerminalSections({
      filters: { mode: "all", state: "all", watchlistOnly: false, query: "ORCL" },
      gapIntelligence: [
        {
          symbol: "ORCL",
          company_name: "Oracle",
          gap_pct: 4.2,
          gap_dollars: 7,
          prev_close: 175,
          current_price: 182.4,
          volume: 1_000_000,
          volume_vs_avg: 1.5,
          gap_quality_score: 75,
          catalyst: null,
          has_catalyst: false,
          no_catalyst_warning: null
        },
        {
          symbol: "AMD",
          company_name: "AMD",
          gap_pct: 2.1,
          gap_dollars: 3,
          prev_close: 140,
          current_price: 143,
          volume: 500_000,
          volume_vs_avg: 1.1,
          gap_quality_score: 55,
          catalyst: null,
          has_catalyst: false,
          no_catalyst_warning: null
        }
      ],
      setups: [],
      swingDesk: null,
      dayDesk: null,
      nearQualification: [],
      dayTradingSurfaces: true,
      watchlistSymbols: new Set(),
      sectorRotation: [{ symbol: "XLK", label: "Tech", pct5d: 1.1 }]
    });

    expect(sections.gaps).toHaveLength(1);
    expect(sections.gaps[0]?.symbol).toBe("ORCL");
  });

  test("dedupeDevelopingRows keeps one row per symbol across desks", () => {
    const rows = dedupeDevelopingRows([
      {
        id: "day:BFLY",
        symbol: "BFLY",
        company: null,
        lane: "day",
        state: "near",
        bias: "bull",
        alignment: { aligned: 3, total: 6 },
        riskReward: null,
        verdict: "Near",
        price: 6.61,
        changePct: 15.7,
        blockerNote: null,
        triggers: []
      },
      {
        id: "swing:BFLY",
        symbol: "BFLY",
        company: "Butterfly Network",
        lane: "swing",
        state: "near",
        bias: "bull",
        alignment: { aligned: 3, total: 6 },
        riskReward: null,
        verdict: "Near",
        price: 6.61,
        changePct: 15.7,
        blockerNote: null,
        triggers: []
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("BFLY");
    expect(rows[0]?.company).toBe("Butterfly Network");
  });

  test("splitDevelopingRows separates near from potential", () => {
    const { closest, also } = splitDevelopingRows([
      {
        id: "swing:AMD",
        symbol: "AMD",
        company: null,
        lane: "swing",
        state: "near",
        bias: "bull",
        alignment: { aligned: 5, total: 6 },
        riskReward: null,
        verdict: "Near",
        price: null,
        changePct: null,
        blockerNote: null,
        triggers: []
      },
      {
        id: "swing:MSFT",
        symbol: "MSFT",
        company: null,
        lane: "swing",
        state: "potential",
        bias: "bull",
        alignment: null,
        riskReward: null,
        verdict: "Watch",
        price: null,
        changePct: null,
        blockerNote: null
      }
    ]);
    expect(closest).toHaveLength(1);
    expect(closest[0]?.symbol).toBe("AMD");
    expect(also).toHaveLength(1);
    expect(also[0]?.symbol).toBe("MSFT");
  });

  test("gapFillWatchReason explains fill watch state", () => {
    const reason = gapFillWatchReason({
      symbol: "SRAD",
      company_name: "SRAD",
      gap_pct: 11.4,
      gap_dollars: 2,
      prev_close: 20,
      current_price: 22.4,
      volume: 1_000_000,
      volume_vs_avg: 0.9,
      gap_quality_score: 58,
      catalyst: null,
      has_catalyst: false,
      no_catalyst_warning: null
    });
    expect(reason.toLowerCase()).toContain("fill watch");
    expect(reason).not.toContain("63/100");
  });

  test("isTickerSearchQuery accepts tickers only", () => {
    expect(isTickerSearchQuery("OKTA")).toBe("OKTA");
    expect(isTickerSearchQuery("  nvda ")).toBe("NVDA");
    expect(isTickerSearchQuery("why missing")).toBeNull();
  });

  test("selectionTitle resolves symbol and radar group labels", () => {
    const sections = buildScannerTerminalSections({
      filters: { mode: "all", state: "all", watchlistOnly: false, query: "" },
      gapIntelligence: [
        {
          symbol: "ORCL",
          company_name: "Oracle",
          gap_pct: 4.2,
          gap_dollars: 7,
          prev_close: 175,
          current_price: 182.4,
          volume: 1_000_000,
          volume_vs_avg: 1.5,
          gap_quality_score: 75,
          catalyst: null,
          has_catalyst: false,
          no_catalyst_warning: null,
          mode_best_fit: "swing"
        }
      ],
      setups: [
        {
          symbol: "NVDA",
          direction: "bullish",
          score: 82,
          triggers: ["EMA cross"],
          timestamp_iso: new Date().toISOString(),
          qualification_tier: "qualifying",
          alignment: { aligned: 5, total: 6, label: "5/6 layers" },
          scanner_mode: "swing_daily"
        }
      ],
      swingDesk: null,
      dayDesk: null,
      nearQualification: [],
      dayTradingSurfaces: true,
      watchlistSymbols: new Set(),
      sectorRotation: [{ symbol: "XLK", label: "Tech", pct5d: 1.1 }]
    });

    expect(selectionTitle({ kind: "gap", symbol: "ORCL" }, sections)).toBe("ORCL");
    const signalId = sections.actionable.find((r) => r.symbol === "NVDA")?.id;
    expect(signalId).toBeTruthy();
    expect(selectionTitle({ kind: "signal", id: signalId! }, sections)).toBe("NVDA");
    const radarId = sections.radar[0]?.id;
    if (radarId) {
      expect(selectionTitle({ kind: "radar", groupId: radarId }, sections)).toBeTruthy();
    }
    expect(selectionTitle(null, sections)).toBeNull();
  });
});
