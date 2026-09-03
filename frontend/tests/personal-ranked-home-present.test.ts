import { describe, expect, test } from "vitest";

import type { DeskTodayData } from "@/lib/api/desk-today";
import {
  buildMarketSwingRankedRows,
  buildPersonalRankedRows,
  collectMarketSwingSymbols,
  collectPersonalRankedSymbols
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
