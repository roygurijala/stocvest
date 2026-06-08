import { describe, expect, test } from "vitest";
import {
  buildScannerTerminalSections,
  isTickerSearchQuery,
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
    expect(sections.actionable.some((r) => r.symbol === "NVDA")).toBe(true);
    expect(sections.developing.some((r) => r.symbol === "AMD")).toBe(true);
    expect(sections.actionableCount).toBeGreaterThanOrEqual(1);
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
        blockerNote: null
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

  test("isTickerSearchQuery accepts tickers only", () => {
    expect(isTickerSearchQuery("OKTA")).toBe("OKTA");
    expect(isTickerSearchQuery("  nvda ")).toBe("NVDA");
    expect(isTickerSearchQuery("why missing")).toBeNull();
  });
});
