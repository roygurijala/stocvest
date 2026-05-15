/**
 * Tier 1.C — deferred scanner path: `EMPTY_SCANNER_OVERVIEW` on first paint,
 * then `DashboardScannerHydrate` in `deferredScannerSlot` applies the real
 * overview into `ScannerOverviewProvider` (same wiring as RSC nested Suspense).
 */

import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DashboardScannerHydrate } from "@/components/dashboard/dashboard-scanner-hydrate";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
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

describe("Tier 1.C — deferred scanner hydrate → ribbon", () => {
  test("hydrate_in_deferred_slot_updates_ribbon_when_initial_scanner_is_empty", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "HYDRIBB",
      direction: "bullish",
      score: 0.78,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:30:00Z"
    };
    const hydratedOverview = {
      ...EMPTY_SCANNER_OVERVIEW,
      setups: [daySetup],
      spyPct: 0.1,
      qqqPct: 0.1
    };

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
        deferredScannerSlot={<DashboardScannerHydrate overview={hydratedOverview} />}
      />
    );

    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    expect(ribbon.getAttribute("data-ribbon-state")).toBe("active");
    expect(ribbon.querySelector('[data-testid="ribbon-chip-HYDRIBB"]')).not.toBeNull();
    expect(ribbon.getAttribute("data-ribbon-chip-count")).toBe("1");
  });
});
