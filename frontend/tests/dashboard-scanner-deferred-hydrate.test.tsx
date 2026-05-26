/**
 * Tier 1.C — deferred scanner path: `EMPTY_SCANNER_OVERVIEW` on first paint,
 * then `DashboardScannerHydrate` in `deferredScannerSlot` applies the real
 * overview into `ScannerOverviewProvider` (same wiring as RSC nested Suspense).
 */

import "./mocks/dashboard-desk-refresh";

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DashboardScannerHydrate } from "@/components/dashboard/dashboard-scanner-hydrate";
import { useScannerOverview } from "@/components/dashboard/scanner-overview-context";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";
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

function ScanSummaryProbe() {
  const overview = useScannerOverview();
  const total = overview.scanSummary?.qualifying.total ?? -1;
  const near = overview.scanSummary?.near_qualification.length ?? -1;
  return (
    <div
      data-testid="dashboard-scan-summary-probe"
      data-qualifying-total={String(total)}
      data-near-count={String(near)}
    />
  );
}

describe("Tier 1.C — deferred scanner hydrate → dashboard surfaces", () => {
  test("hydrate_in_deferred_slot_updates_system_banner_when_initial_scanner_is_empty", () => {
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

    const hero = screen.getByTestId("dashboard-market-pulse-hero");
    expect(hero.textContent).toMatch(/ACTIONABLE/i);

    const discovery = screen.getByTestId("dashboard-discovery-feed");
    expect(discovery.querySelector('a[href="/dashboard/scanner?mode=day"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    expect(discovery.querySelector('a[href="/dashboard/scanner?mode=swing"]')).not.toBeNull();
  });

  test("hydrate_carries_scanSummary_into_scanner_overview_context", () => {
    const scanSummary = buildScannerScanSummary({
      scannedAtIso: "2026-05-16T14:30:00.000Z",
      overview: {
        setups: [],
        gapIntelligence: [],
        regimeLabel: "Neutral",
        spyPct: 0.05,
        qqqPct: -0.02,
        swingUniverseSymbolCount: 200,
        gapIntelligenceSnapshotSymbolCount: 80,
        watchlistStatus: { monitored: 3, actionable: 0, developing: 1, inactive: 2 }
      },
      nearQualificationSetups: [
        {
          symbol: "HYDRNEAR",
          direction: "long",
          score: 0.39,
          triggers: ["vwap_reclaim", "orb_breakout_long"],
          timestamp_iso: "2026-05-16T14:00:00Z"
        }
      ],
      watchlistProgression: []
    });
    const hydratedOverview = {
      ...EMPTY_SCANNER_OVERVIEW,
      scanSummary,
      spyPct: 0.05,
      qqqPct: -0.02
    };

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
        deferredScannerSlot={
          <>
            <DashboardScannerHydrate overview={hydratedOverview} />
            <ScanSummaryProbe />
          </>
        }
      />
    );

    const probe = screen.getByTestId("dashboard-scan-summary-probe");
    expect(probe.getAttribute("data-qualifying-total")).toBe("0");
    expect(probe.getAttribute("data-near-count")).toBe("1");
  });
});
