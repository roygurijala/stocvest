/**
 * Dashboard → Scanner URLs after the command-center redesign.
 */

import "./mocks/dashboard-desk-refresh";

import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";

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
    const discovery = screen.getByTestId("dashboard-discovery-feed");
    expect(discovery.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    expect(discovery.querySelector('a[href="/dashboard/scanner?mode=swing"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-day"));
    expect(discovery.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
  });

  test("execution_ready_strip_market_pill_points_at_scanner_for_active_desk", async () => {
    const setups = [
      {
        symbol: "INTRADAY",
        direction: "long",
        score: 0.9,
        triggers: ["orb_breakout_long"],
        timestamp_iso: "2026-05-01T14:30:00Z"
      },
      {
        symbol: "AAA",
        direction: "bullish",
        score: 0.88,
        triggers: ["ema50_cross_above_200"],
        timestamp_iso: "2026-05-01T12:00:00Z",
        scanner_mode: "swing_daily"
      }
    ];
    const overview = {
      ...baseScanner,
      setups,
      scanSummary: buildScannerScanSummary({
        scannedAtIso: "2026-05-01T14:30:00Z",
        overview: { ...baseScanner, setups },
        nearQualificationSetups: [],
        watchlistProgression: []
      })
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={overview}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(await screen.findByTestId("dashboard-execution-ready-pill-market")).toBeTruthy();
    expect(
      screen.getByTestId("dashboard-execution-ready-pill-market").getAttribute("href")
    ).toBe("/dashboard/scanner?mode=day");
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-execution-ready-pill-market").getAttribute("href")).toBe(
        "/dashboard/scanner?mode=swing"
      );
    });
  });
});
