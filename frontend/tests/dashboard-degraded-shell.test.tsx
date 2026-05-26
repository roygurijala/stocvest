/**
 * Tier 1.C Phase 5 — dashboard renders a usable shell when market + scanner degrade.
 */

import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/hooks/use-dashboard-desk-refresh", () => ({
  useDashboardDeskRefresh: () => ({
    data: null,
    isLoading: false,
    isValidating: false,
    error: null,
    mutate: vi.fn(),
    refreshDesk: vi.fn(),
    manualRefreshBusy: false,
    canManualRefresh: true,
    cooldownRemainingMs: 0,
    cooldownLabel: null,
    refreshError: null
  })
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => {}
}));

vi.mock("@/lib/hooks/use-macro-context", () => ({
  useMacroContext: () => ({ data: null })
}));

vi.mock("@/lib/hooks/use-dashboard-payload", () => ({
  useDashboardPayload: () => ({ data: null })
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

describe("Dashboard degraded shell (Phase 5)", () => {
  test("hero_and_ribbon_render_with_market_and_scanner_errors", () => {
    const degradedMarket: MarketOverview = {
      snapshots: [],
      news: [],
      status: buildMarketStatus("open"),
      error: "Market data timed out."
    };
    const degradedScanner = {
      ...EMPTY_SCANNER_OVERVIEW,
      error: "Scanner timed out."
    };

    wrap(
      <DashboardRedesign
        marketOverview={degradedMarket}
        scannerOverview={degradedScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );

    expect(screen.getByTestId("dashboard-market-pulse-hero")).toBeInTheDocument();
    const heroText = screen.getByTestId("dashboard-market-pulse-hero").textContent || "";
    expect(heroText).toMatch(/scanner still loading|scanner/i);
    expect(screen.queryByTestId("dashboard-active-signal-ribbon")).toBeNull();
    expect(screen.queryByTestId("dashboard-universe-strip")).toBeNull();
    expect(screen.queryByTestId("dashboard-discovery-row")).toBeNull();
  });
});
