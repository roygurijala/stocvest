/**
 * Tier 1.C — deferred earnings: empty initial lists, then `DashboardEarningsHydrate`
 * in `deferredEarningsSlot` applies server data (same wiring as RSC nested Suspense).
 */

import type { ReactElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DashboardEarningsHydrate } from "@/components/dashboard/dashboard-earnings-hydrate";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";
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

describe("Tier 1.C — deferred earnings hydrate → calendar", () => {
  test("hydrate_in_deferred_slot_shows_calendar_when_initial_earnings_empty", () => {
    const row: EarningsEvent = {
      symbol: "HYDREARN",
      company_name: "Deferred Earnings Co",
      report_date: "2026-05-20",
      report_time: "after_market",
      market_cap: 2_000_000_000_000
    };

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
        deferredEarningsSlot={<DashboardEarningsHydrate upcoming={[row]} recent={[]} />}
      />
    );

    const calendarHeading = screen.getByRole("heading", { name: /Upcoming Earnings \(Next 7 Days\)/i });
    const calendarSection = calendarHeading.closest("section");
    expect(calendarSection).not.toBeNull();
    expect(within(calendarSection as HTMLElement).getByText("HYDREARN")).toBeInTheDocument();
    expect(within(calendarSection as HTMLElement).getByText("Deferred Earnings Co")).toBeInTheDocument();
  });
});
