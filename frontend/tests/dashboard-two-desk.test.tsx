/**
 * Dual-desk dashboard: both desks appear as status lines (not full panels).
 */

import "./mocks/dashboard-desk-refresh";

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

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

describe("dashboard two-desk status (focus layout)", () => {
  test("system_banner_includes_swing_and_day_posture_in_detail", () => {
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
    const hero = screen.getByTestId("dashboard-market-pulse-hero");
    expect(hero.textContent || "").toMatch(/Swing:/i);
    expect(hero.textContent || "").toMatch(/Day:/i);
  });

  test("opportunities_cards_link_to_day_scanner_and_watchlist", () => {
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
    const radar = screen.getByTestId("dashboard-watchlist-radar");
    expect(radar.querySelector('a[href="/dashboard/watchlists?desk=day"]')).not.toBeNull();
    expect(screen.getByTestId("dashboard-discovery-feed").querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
  });

  test("market_context_panel_replaces_legacy_shared_context_strip", () => {
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
    expect(screen.getByTestId("dashboard-market-context")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-context-master-card")).toBeNull();
  });

  test("view_day_scanner_link_in_opportunities_when_day_mode", () => {
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
    const link = screen.getByTestId("dashboard-discovery-scanner-link");
    expect(link.getAttribute("href")).toBe("/dashboard/scanner?mode=day");
  });
});
