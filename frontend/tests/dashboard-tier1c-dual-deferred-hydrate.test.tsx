/**
 * Tier 1.C — both deferred legs hydrate in one mount (earnings + scanner).
 * Guards ordering/regressions when `deferredEarningsSlot` and `deferredScannerSlot` are both set.
 */

import type { ReactElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DashboardEarningsHydrate } from "@/components/dashboard/dashboard-earnings-hydrate";
import { DashboardScannerHydrate } from "@/components/dashboard/dashboard-scanner-hydrate";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function buildMarketStatus(market: string): MarketStatusPayload {
  return { market, exchanges: {}, currencies: {} };
}

const baseMarket: MarketOverview = {
  snapshots: [],
  news: [],
  status: buildMarketStatus("open")
};

const baseWeekly = [
  { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
  { symbol: "QQQ", label: "Tech / growth", pct5d: 1, lastPrice: 400 },
  { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
];

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
});

describe("Tier 1.C — dual deferred hydrate (earnings + scanner)", () => {
  test("ribbon_and_earnings_calendar_both_reflect_hydrated_payloads", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "DUALSIG",
      direction: "bullish",
      score: 0.81,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:30:00Z"
    };
    const scannerOverview = {
      ...EMPTY_SCANNER_OVERVIEW,
      setups: [daySetup],
      spyPct: 0.1,
      qqqPct: 0.1
    };
    const earn: EarningsEvent = {
      symbol: "DUALERN",
      company_name: "Dual Stream Co",
      report_date: "2026-06-02",
      report_time: "before_market",
      market_cap: 500_000_000_000
    };

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
        deferredEarningsSlot={<DashboardEarningsHydrate upcoming={[earn]} recent={[]} />}
        deferredScannerSlot={<DashboardScannerHydrate overview={scannerOverview} />}
      />
    );

    expect(screen.getByTestId("dashboard-system-state-banner").textContent || "").toMatch(/ACTIONABLE/i);
    expect(screen.queryByTestId("dashboard-active-signal-ribbon")).toBeNull();

    const calendarHeading = screen.getByRole("heading", { name: /Upcoming Earnings \(Next 7 Days\)/i });
    const calendarSection = calendarHeading.closest("section");
    expect(calendarSection).not.toBeNull();
    expect(within(calendarSection as HTMLElement).getByText("DUALERN")).toBeInTheDocument();
    expect(within(calendarSection as HTMLElement).getByText("Dual Stream Co")).toBeInTheDocument();
  });
});
