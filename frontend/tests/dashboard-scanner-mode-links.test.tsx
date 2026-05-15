/**
 * Dashboard → Scanner URLs after the focus-layout redesign.
 */

import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

describe("Desk status scanner links", () => {
  test("desk_status_includes_swing_and_day_scanner_hrefs", () => {
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
    const desk = screen.getByTestId("dashboard-desk-status");
    const swing = Array.from(desk.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/scanner?mode=swing"
    );
    const day = Array.from(desk.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/scanner?mode=day"
    );
    expect(swing).toBeDefined();
    expect(day).toBeDefined();
  });

  test("next_actions_open_scanner_uses_swing_mode_query", () => {
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
    const na = screen.getByTestId("dashboard-next-actions");
    const open = na.querySelector('a[href="/dashboard/scanner?mode=swing"]');
    expect(open).not.toBeNull();
  });
});
