import { describe, expect, test } from "vitest";

import type { DeskTodayData } from "@/lib/api/desk-today";
import {
  buildMarketSwingRankedRows,
  buildMarketSwingRankedRowsResult,
  buildPersonalRankedRows,
  collectMarketSwingSymbols,
  collectPersonalRankedSymbols,
  marketSwingTableSourceDisclaimer
} from "@/lib/dashboard/personal-ranked-home-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

function maturation(partial: Partial<WatchlistMaturationRow>): WatchlistMaturationRow {
  return partial;
}

describe("collectMarketSwingSymbols", () => {
  test("includes only desk discovery and quiet leaders", () => {
    const swingDesk: DeskTodayData = {
      discovery: [
        {
          symbol: "nvda",
          gap_percent: 1.2,
          direction: "up",
          rank_score: 90,
          desk: "swing",
          desk_surface_eligible: true
        }
      ],
      quiet_leaders: [
        {
          symbol: "aapl",
          gap_percent: 0.2,
          direction: "up",
          rank_score: 70,
          desk: "swing",
          desk_surface_eligible: true,
          why_line: "Low velocity · structure"
        }
      ]
    };
    expect(collectMarketSwingSymbols(swingDesk)).toEqual(["NVDA", "AAPL"]);
  });

  test("excludes ineligible desk rows", () => {
    const swingDesk: DeskTodayData = {
      discovery: [
        {
          symbol: "NVDQ",
          gap_percent: -2,
          direction: "down",
          rank_score: 40,
          desk: "swing",
          desk_surface_eligible: false
        }
      ]
    };
    expect(collectMarketSwingSymbols(swingDesk)).toEqual([]);
  });
});

describe("buildMarketSwingRankedRows", () => {
  test("ranks actionable desk leaders first and fills columns from desk payload", () => {
    const rows = buildMarketSwingRankedRows({
      discovery: [
        {
          symbol: "EVC",
          gap_percent: 0.5,
          direction: "up",
          rank_score: 60,
          desk: "swing",
          desk_surface_eligible: true,
          alignment_ratio: 0.67,
          decision_state: "monitor",
          verdict: "Developing swing setup"
        },
        {
          symbol: "NVDA",
          gap_percent: 1.2,
          direction: "up",
          rank_score: 95,
          desk: "swing",
          desk_surface_eligible: true,
          alignment_ratio: 0.83,
          direction_confidence: "High",
          verdict: "Bullish swing setup",
          decision_state: "actionable",
          execution_actionable: true,
          risk_reward: 2.4,
          structure_risk_reward: 2.4,
          execution_hint: "In zone — review sizing"
        }
      ]
    });

    expect(rows.map((r) => r.symbol)).toEqual(["NVDA", "EVC"]);
    expect(rows[0].direction).toBe("High · Long");
    expect(rows[0].riskReward).toBe("2.4:1");
    expect(rows[0].readiness).toBe("5/6 aligned");
    expect(rows[0].why).toMatch(/zone|review sizing/i);
  });

  test("uses geometry block reason when desk marks symbol not tradable", () => {
    const rows = buildMarketSwingRankedRows({
      discovery: [
        {
          symbol: "NVDQ",
          gap_percent: -2,
          direction: "down",
          rank_score: 40,
          desk: "swing",
          desk_surface_eligible: true,
          geometry_block_reason: "Leveraged product excluded from swing universe",
          decision_state: "blocked"
        }
      ]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].why).toBe("Leveraged product excluded from swing universe");
  });

  test("falls back to developing desk rows when eligible discovery is empty", () => {
    const rows = buildMarketSwingRankedRows({
      discovery: [],
      developing_setups: [
        {
          symbol: "EVC",
          gap_percent: 0.5,
          direction: "up",
          rank_score: 60,
          desk: "swing",
          desk_surface_eligible: false,
          alignment_ratio: 0.67,
          decision_state: "monitor",
          geometry_block_reason: "Structure R/R below desk minimum",
          verdict: "Developing swing setup"
        }
      ]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("EVC");
    expect(rows[0].why).toBe("Structure R/R below desk minimum");
  });

  test("falls back to near-qualification swing rows when desk and scanner are empty", () => {
    const rows = buildMarketSwingRankedRows({
      swingDesk: { discovery: [], quiet_leaders: [] },
      nearQualification: [
        {
          symbol: "NEAR1",
          desk: "swing",
          score: 0.42,
          direction: "long",
          alignment: { aligned: 4, total: 6, label: "4/6 layers aligned" },
          layers_away: 1
        }
      ]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("NEAR1");
    expect(rows[0].state).toBe("Near ready");
  });

  test("prefers eligible desk rows over developing fallbacks", () => {
    const result = buildMarketSwingRankedRowsResult({
      discovery: [
        {
          symbol: "NVDA",
          gap_percent: 1.2,
          direction: "up",
          rank_score: 95,
          desk: "swing",
          desk_surface_eligible: true,
          verdict: "Bullish swing setup"
        }
      ],
      developing_setups: [
        {
          symbol: "EVC",
          gap_percent: 0.5,
          direction: "up",
          rank_score: 60,
          desk: "swing",
          desk_surface_eligible: false,
          geometry_block_reason: "Structure R/R below desk minimum"
        }
      ]
    });
    expect(result.source).toBe("eligible");
    expect(result.rows.map((r) => r.symbol)).toEqual(["NVDA"]);
  });

  test("falls back to scanner swing setups before structure rows", () => {
    const result = buildMarketSwingRankedRowsResult({
      swingDesk: { discovery: [], quiet_leaders: [] },
      swingSetups: [
        {
          symbol: "SCAN1",
          direction: "long",
          score: 78,
          triggers: ["ema_cross"],
          timestamp_iso: "2026-09-03T12:00:00Z",
          scanner_mode: "swing_daily",
          alignment: { aligned: 5, total: 6, label: "5/6 layers aligned" }
        }
      ],
      nearQualification: [
        {
          symbol: "NEAR1",
          desk: "swing",
          score: 0.42,
          direction: "long",
          alignment: { aligned: 4, total: 6, label: "4/6 layers aligned" }
        }
      ]
    });
    expect(result.source).toBe("scanner");
    expect(result.rows[0]?.symbol).toBe("SCAN1");
  });

  test("structure fallback excludes raw low-velocity movers", () => {
    const result = buildMarketSwingRankedRowsResult({
      swingDesk: {
        discovery: [],
        quiet_leaders: [],
        movers_radar: [
          { symbol: "SLOW1", gap_percent: 0.4, direction: "up", rank_score: 40 },
          { symbol: "SLOW2", gap_percent: -0.8, direction: "down", rank_score: 35 }
        ]
      },
      nearQualification: []
    });
    expect(result.rows).toHaveLength(0);
    expect(result.source).toBe("structure");
  });

  test("exposes disclaimer copy for non-eligible sources", () => {
    expect(marketSwingTableSourceDisclaimer("eligible")).toBeNull();
    expect(marketSwingTableSourceDisclaimer("developing")).toMatch(/geometry gates/i);
  });
});

describe("collectPersonalRankedSymbols", () => {
  test("merges watchlist, maturation keys, and desk leaders without duplicates", () => {
    const swingDesk: DeskTodayData = {
      discovery: [
        {
          symbol: "nvda",
          gap_percent: 1.2,
          direction: "up",
          rank_score: 90,
          desk: "swing",
          desk_surface_eligible: true
        }
      ]
    };
    const symbols = collectPersonalRankedSymbols({
      watchlistSymbols: ["MSFT", "NVDA"],
      swingBySymbol: { MSFT: maturation({ state: "developing", layers_aligned: 4, layers_total: 6 }) },
      swingDesk
    });
    expect(symbols).toEqual(["MSFT", "NVDA"]);
  });
});

describe("buildPersonalRankedRows", () => {
  test("still ranks watchlist symbols when explicitly requested", () => {
    const rows = buildPersonalRankedRows({
      watchlistSymbols: ["EVC"],
      swingBySymbol: {
        EVC: maturation({
          state: "developing",
          layers_aligned: 4,
          layers_total: 6,
          bias: "long",
          readiness_label: "Volume confirmation pending"
        })
      },
      swingDesk: null
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("EVC");
    expect(rows[0].why).toMatch(/Volume confirmation/i);
  });
});
