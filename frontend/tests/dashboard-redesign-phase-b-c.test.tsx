/**
 * Dashboard structure lock-ins after the focus-layout redesign.
 * Heavy desk grid / ribbon tests retired — those surfaces moved to Scanner.
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

describe("Dashboard focus shell", () => {
  test("no_desks_grid_or_signal_ribbon_master_cards", () => {
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
    expect(screen.queryByTestId("dashboard-desks-grid")).toBeNull();
    expect(screen.queryByTestId("dashboard-active-signal-ribbon")).toBeNull();
  });

  test("next_actions_links_to_scanner_and_watchlist", () => {
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
    expect(na.querySelector('a[href="/dashboard/scanner?mode=swing"]')).not.toBeNull();
    expect(na.querySelector('a[href="/dashboard/watchlists"]')).not.toBeNull();
  });

  test("watchlist_status_omitted_when_default_watchlist_empty", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, watchlistStatus: null }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(screen.queryByTestId("dashboard-watchlist-status")).toBeNull();
  });

  test("watchlist_status_renders_when_monitored_positive", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{
          ...baseScanner,
          watchlistStatus: { monitored: 4, actionable: 0, developing: 2, inactive: 2 }
        }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(screen.getByTestId("dashboard-watchlist-status")).toBeInTheDocument();
    expect(screen.getByText(/Actionable — returned a setup row/i)).toBeInTheDocument();
  });
});
