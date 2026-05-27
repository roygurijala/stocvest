/**
 * Tier 1.C Phase 2 — `GET /v1/dashboard/summary` client + first-segment mapper.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  apiFetch
}));

describe("dashboard summary API", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("fetchDashboardSummary_builds_query_and_parses_payload", async () => {
    apiFetch.mockResolvedValue({
      status: { market: "open", exchanges: {}, currencies: {} },
      snapshots: [{ symbol: "SPY", last_trade_price: 500 }],
      sparklines_by_symbol: { SPY: [499, 500] },
      daily_closes: { SPY: [490, 495, 500] },
      earnings: { symbols: ["AAPL"], days: 7, upcoming: [], recent: [] }
    });

    const { fetchDashboardSummary } = await import("@/lib/api/dashboard-summary");
    const out = await fetchDashboardSummary({ earningsSymbols: ["AAPL", "MSFT"], earningsDays: 7 });

    expect(out).not.toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const path = String(apiFetch.mock.calls[0]?.[0] ?? "");
    expect(path).toContain("/v1/dashboard/summary?");
    expect(path).toContain("earnings_symbols=AAPL%2CMSFT");
    expect(path).toContain("earnings_days=7");
    expect(out?.daily_closes.SPY).toEqual([490, 495, 500]);
  });

  test("marketOverviewFromDashboardSummary_maps_sparklines", async () => {
    const { marketOverviewFromDashboardSummary } = await import("@/lib/api/dashboard-summary");
    const overview = marketOverviewFromDashboardSummary({
      snapshots: [{ symbol: "SPY" }],
      daily_closes: {},
      earnings: { symbols: [], days: 7, upcoming: [], recent: [] },
      sparklines_by_symbol: { SPY: [1, 2, 3] }
    });
    expect(overview.sparklinesBySymbol?.SPY).toEqual([1, 2, 3]);
    expect(overview.news).toEqual([]);
  });

  test("fetchDashboardFirstSegment_uses_summary_when_present", async () => {
    const summaryPayload = {
      status: { market: "open", exchanges: {}, currencies: {} },
      snapshots: [
        { symbol: "SPY", last_trade_price: 500 },
        { symbol: "QQQ", last_trade_price: 400 },
        { symbol: "IWM", last_trade_price: 200 }
      ],
      daily_closes: {
        SPY: [480, 490, 500],
        QQQ: [380, 390, 400],
        IWM: [180, 190, 200],
        XLK: [100, 105, 110]
      },
      earnings: {
        symbols: ["ZZZ"],
        days: 7,
        upcoming: [
          {
            symbol: "ZZZ",
            company_name: "Zed",
            report_date: "2026-06-01",
            report_time: "after_market"
          }
        ],
        recent: []
      }
    };
    apiFetch.mockImplementation((path: string) => {
      if (String(path).includes("/v1/desk/today")) {
        const mode = String(path).includes("mode=day") ? "day" : "swing";
        return Promise.resolve({ mode, source: "cache_miss", data: null });
      }
      return Promise.resolve(summaryPayload);
    });

    const { fetchDashboardFirstSegment } = await import("@/lib/dashboard/dashboard-page-data");
    const segment = await fetchDashboardFirstSegment(["ZZZ"]);

    expect(segment.earnings.upcoming).toHaveLength(1);
    expect(segment.earnings.upcoming[0]?.symbol).toBe("ZZZ");
    expect(segment.weeklyIndexRows.find((r) => r.symbol === "SPY")?.lastPrice).toBe(500);
    expect(segment.sectorRotation.some((r) => r.symbol === "XLK")).toBe(true);
  });
});
