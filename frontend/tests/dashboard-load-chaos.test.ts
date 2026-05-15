/**
 * Tier 1.C Phase 5 — dashboard fetch resilience + SLO budget lock-ins.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  DASHBOARD_FETCH_BUDGETS,
  DASHBOARD_LOAD_PHASES,
  DASHBOARD_SLO_TARGETS,
  isWithinDashboardHardCeiling,
  isWithinFirstContentfulBudget
} from "@/lib/dashboard/dashboard-slo";
import { timeoutFallback } from "@/lib/dashboard/dashboard-fetch-resilience";

const apiFetch = vi.hoisted(() => vi.fn());
const fetchMarketOverview = vi.hoisted(() => vi.fn());
const fetchDailyBarClosesBySymbol = vi.hoisted(() => vi.fn());
const fetchEarningsCalendar = vi.hoisted(() => vi.fn());
const loadScannerDataWithoutBrief = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({ apiFetch }));
vi.mock("@/lib/api/market", () => ({
  fetchMarketOverview,
  fetchDailyBarClosesBySymbol
}));
vi.mock("@/lib/api/earnings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/earnings")>();
  return {
    ...actual,
    fetchEarningsCalendar
  };
});
vi.mock("@/lib/api/scanner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/scanner")>();
  return {
    ...actual,
    loadScannerDataWithoutBrief
  };
});

describe("timeoutFallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves_fallback_when_promise_exceeds_ms", async () => {
    const pending = new Promise<string>(() => {});
    const result = timeoutFallback(pending, 100, "degraded");
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("degraded");
  });

  test("resolves_fallback_when_promise_rejects", async () => {
    await expect(
      timeoutFallback(Promise.reject(new Error("polygon down")), 5000, { ok: false })
    ).resolves.toEqual({ ok: false });
  });

  test("resolves_promise_value_when_faster_than_timeout", async () => {
    await expect(timeoutFallback(Promise.resolve("fast"), 100, "slow")).resolves.toBe("fast");
  });
});

describe("dashboard SLO helpers", () => {
  test("hard_ceiling_and_first_contentful_budgets_match_plan", () => {
    expect(DASHBOARD_SLO_TARGETS.firstContentfulP75Ms).toBe(2000);
    expect(DASHBOARD_SLO_TARGETS.scannerDesksUsableP75Ms).toBe(8000);
    expect(DASHBOARD_SLO_TARGETS.productHardCeilingMs).toBe(15_000);
    expect(isWithinFirstContentfulBudget(1999)).toBe(true);
    expect(isWithinFirstContentfulBudget(2000)).toBe(false);
    expect(isWithinDashboardHardCeiling(14_999)).toBe(true);
    expect(isWithinDashboardHardCeiling(15_000)).toBe(false);
  });

  test("fetch_budgets_are_wired_to_page_data_constants", () => {
    expect(DASHBOARD_FETCH_BUDGETS.earningsTimeoutMs).toBe(5000);
    expect(DASHBOARD_FETCH_BUDGETS.earningsTimeoutMs).toBeLessThan(
      DASHBOARD_SLO_TARGETS.scannerDesksUsableP75Ms
    );
    expect(DASHBOARD_FETCH_BUDGETS.scannerTimeoutMs).toBeGreaterThan(
      DASHBOARD_SLO_TARGETS.productHardCeilingMs
    );
    expect(DASHBOARD_LOAD_PHASES).toContain("dashboard_summary");
    expect(DASHBOARD_LOAD_PHASES).toContain("scanner_core");
  });
});

describe("fetchDashboardFirstSegment chaos", () => {
  beforeEach(() => {
    vi.resetModules();
    apiFetch.mockReset();
    fetchMarketOverview.mockReset();
    fetchDailyBarClosesBySymbol.mockReset();
    fetchEarningsCalendar.mockReset();
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses_legacy_parallel_slice_when_summary_returns_null", async () => {
    apiFetch.mockResolvedValue(null);
    fetchMarketOverview.mockResolvedValue({
      snapshots: [{ symbol: "SPY", last_trade_price: 501 }],
      news: [],
      status: { market: "open", exchanges: {}, currencies: {} }
    });
    fetchDailyBarClosesBySymbol.mockResolvedValue({
      SPY: [490, 500],
      QQQ: [390, 400],
      IWM: [190, 200],
      XLK: [100, 110]
    });
    fetchEarningsCalendar.mockResolvedValue({
      symbols: ["AAPL"],
      days: 7,
      upcoming: [
        {
          symbol: "AAPL",
          company_name: "Apple",
          report_date: "2026-06-01",
          report_time: "after_market"
        }
      ],
      recent: []
    });

    const { fetchDashboardFirstSegment } = await import("@/lib/dashboard/dashboard-page-data");
    const segment = await fetchDashboardFirstSegment(["AAPL"]);

    expect(fetchMarketOverview).toHaveBeenCalled();
    expect(fetchEarningsCalendar).toHaveBeenCalled();
    expect(segment.marketOverview.snapshots[0]?.symbol).toBe("SPY");
    expect(segment.earnings.upcoming[0]?.symbol).toBe("AAPL");
  });

  test("falls_back_to_market_timeout_payload_when_summary_hangs", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation(() => new Promise(() => {}));
    fetchMarketOverview.mockResolvedValue({
      snapshots: [],
      news: [],
      error: "Market data timed out."
    });
    fetchDailyBarClosesBySymbol.mockResolvedValue({});
    fetchEarningsCalendar.mockResolvedValue({
      symbols: [],
      days: 7,
      upcoming: [],
      recent: [],
      notice: "Earnings feed timed out."
    });

    const { fetchDashboardFirstSegment, DASHBOARD_MARKET_TIMEOUT_MS } = await import(
      "@/lib/dashboard/dashboard-page-data"
    );
    const segmentPromise = fetchDashboardFirstSegment(["AAPL"]);
    await vi.advanceTimersByTimeAsync(DASHBOARD_MARKET_TIMEOUT_MS + 1);
    const segment = await segmentPromise;

    expect(segment.marketOverview.error).toBe("Market data timed out.");
    expect(segment.earnings.upcoming).toEqual([]);
    vi.useRealTimers();
  });
});

describe("fetchDashboardScannerCoreSlice chaos", () => {
  beforeEach(() => {
    vi.resetModules();
    loadScannerDataWithoutBrief.mockReset();
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns_scanner_fallback_when_core_load_hangs", async () => {
    vi.useFakeTimers();
    loadScannerDataWithoutBrief.mockImplementation(() => new Promise(() => {}));

    const { fetchDashboardScannerCoreSlice, DASHBOARD_SCANNER_TIMEOUT_MS } = await import(
      "@/lib/dashboard/dashboard-page-data"
    );
    const slicePromise = fetchDashboardScannerCoreSlice({});
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCANNER_TIMEOUT_MS + 1);
    const slice = await slicePromise;

    expect(slice.error).toBe("Scanner timed out.");
    expect(slice.setups).toEqual([]);
    expect(slice.gapIntelligence).toEqual([]);
    vi.useRealTimers();
  });
});

describe("fetchDashboardEarningsSlice chaos", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchEarningsCalendar.mockReset();
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns_empty_calendar_with_notice_when_earnings_hangs", async () => {
    vi.useFakeTimers();
    fetchEarningsCalendar.mockImplementation(() => new Promise(() => {}));

    const { fetchDashboardEarningsSlice, DASHBOARD_EARNINGS_TIMEOUT_MS } = await import(
      "@/lib/dashboard/dashboard-page-data"
    );
    const slicePromise = fetchDashboardEarningsSlice(["AAPL"]);
    await vi.advanceTimersByTimeAsync(DASHBOARD_EARNINGS_TIMEOUT_MS + 1);
    const slice = await slicePromise;

    expect(slice.upcoming).toEqual([]);
    expect(slice.recent).toEqual([]);
    vi.useRealTimers();
  });
});
