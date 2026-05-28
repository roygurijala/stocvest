/**
 * Swing Pro subscription: intraday desk and day-scanner affordances are hidden.
 * Complements `dashboard-two-desk.test.tsx`, which pins the dual-desk default.
 */

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

describe("Dashboard — Swing Pro surfaces (dayTradingSurfaces=false)", () => {
  test("swing_only_shows_command_center_without_day_mode_or_legacy_desk_panels", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
        dayTradingSurfaces={false}
      />
    );
    expect(screen.queryByTestId("swing-desk-panel")).toBeNull();
    expect(screen.queryByTestId("shared-context-master-card")).toBeNull();
    expect(screen.queryByTestId("day-desk-panel")).toBeNull();
    expect(screen.getByTestId("dashboard-market-detail")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-market-context", { hidden: true })).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-desk-mode-day")).toBeNull();
    expect(screen.queryByRole("link", { name: /day scanner/i })).toBeNull();
  });
});
