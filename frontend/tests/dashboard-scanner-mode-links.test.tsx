/**
 * Dashboard → Scanner URLs after the command-center redesign.
 */

import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";

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

const baseScanner: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: 0.1,
  qqqPct: 0.1,
  regimeLabel: "Neutral"
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

describe("Opportunities scanner links", () => {
  test("opportunities_scanner_href_follows_active_desk_mode", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const opportunities = screen.getByTestId("dashboard-opportunities");
    expect(opportunities.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    expect(opportunities.querySelector('a[href="/dashboard/scanner?mode=swing"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-day"));
    expect(opportunities.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
  });

  test("live_status_cta_points_at_scanner_for_active_desk", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const live = screen.getByTestId("dashboard-live-status");
    expect(live.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    expect(live.querySelector('a[href="/dashboard/scanner?mode=swing"]')).not.toBeNull();
  });
});
